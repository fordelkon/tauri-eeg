import type { CreateRunInput, EmitEventInput } from '../../experiment/api';
import type { ExperimentPreferences } from '../../experiment/settings';
import type { BatteryAnswers } from '../../mentalScale/instruments/battery';
import type { ScalePhase } from '../../mentalScale/scaleRecordsApi';
import { describeFriendlyError } from '../../ui/friendlyError';
import {
  createEffectEvaluationFlowState, regulationFinishModeFromRemaining,
  remainingRegulationSeconds, setupBlockingReason, type EffectEvaluationFlowState,
  type EffectFlowStep,
} from './effectEvaluationFlow';
import type { InductionPoolStatus } from './effectInductionPool';

type Draft = Pick<EffectEvaluationFlowState, 'subjectId' | 'emotion' | 'method' | 'condition' | 'durationMinutes'>;
type Snapshot = {
  state: EffectEvaluationFlowState;
  actionError: string | null;
  isSavingScale: boolean;
  isStartingRun: boolean;
  isWindowElapsed: boolean;
};

export type EffectExecutionDependencies = {
  createRun(input: CreateRunInput): Promise<{ runId: string }>;
  emitEvent(input: EmitEventInput): Promise<unknown>;
  finishRun(runId: string, status: 'completed' | 'aborted'): Promise<unknown>;
  linkScale(runId: string, recordId: string, phase: ScalePhase): Promise<unknown>;
  saveScale(state: EffectEvaluationFlowState, phase: ScalePhase, answers: BatteryAnswers): Promise<{ id: string }>;
  scaleSaved(state: EffectEvaluationFlowState, answers: BatteryAnswers): void;
  preferences(): ExperimentPreferences;
  consumeRecordingConfirmation(): void;
  userId(): string | null;
  paradigmActive(): boolean;
  subjectSelected(subjectId: string): void;
  wallNow(): number;
  monotonicNow(): number;
};

export class EffectEvaluationExecution {
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private events = new Map<string, Promise<void>>();
  private eventTail: Promise<void> = Promise.resolve();
  private operation: { name: string; result: Promise<boolean> } | null = null;
  private abortPromise: Promise<unknown> | null = null;
  private recoveryPending: boolean;
  private disposed = false;
  private generation = 0;

  constructor(initial: EffectEvaluationFlowState, private readonly dependencies: EffectExecutionDependencies, restored = false) {
    this.recoveryPending = restored && initial.runId !== null && initial.step < 5;
    this.snapshot = {
      state: this.recoveryPending ? { ...initial, interrupted: true, eventLogStatus: 'interrupted' } : initial,
      actionError: null, isSavingScale: false, isStartingRun: false, isWindowElapsed: false,
    };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  bindPlayback = () => {
    const generation = this.generation;
    return {
      inductionOnset: (mediaId: string) => generation === this.generation ? this.inductionOnset(mediaId) : Promise.resolve(),
      completeInduction: () => generation === this.generation ? this.completeInduction() : Promise.resolve(false),
      beginRegulation: (mediaId?: string, details?: unknown) => generation === this.generation ? this.beginRegulation(mediaId, details) : Promise.resolve(),
      playbackError: () => generation === this.generation ? this.playbackError() : Promise.resolve(),
      conditionElapsed: () => generation === this.generation ? this.conditionElapsed() : Promise.resolve(),
    };
  };

  private publish(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }

  private changeState(patch: Partial<EffectEvaluationFlowState>) {
    this.publish({ state: { ...this.snapshot.state, ...patch } });
  }

  private allowed(step: EffectFlowStep) {
    return !this.disposed && this.snapshot.state.step === step && !this.snapshot.state.interrupted;
  }

  private abort() {
    const { runId } = this.snapshot.state;
    if (!runId) return Promise.resolve();
    this.abortPromise ??= this.dependencies.finishRun(runId, 'aborted').catch(error => {
      this.abortPromise = null;
      throw error;
    });
    return this.abortPromise;
  }

  private async fail(error: unknown) {
    this.publish({ actionError: describeFriendlyError(error, '实验事件发送') });
    this.changeState({ interrupted: true, eventLogStatus: 'interrupted' });
    await this.abort().catch(() => {});
  }

  private event(eventName: string, phase: string, mediaId?: string, details?: unknown): Promise<void> {
    const { runId, interrupted } = this.snapshot.state;
    if (!runId || interrupted) return Promise.reject(new Error('实验未启动或已中断，请重置后重新开始。'));
    const eventId = `${runId}:${phase}:${eventName}`;
    const existing = this.events.get(eventId);
    if (existing) return existing;
    const frontendMonotonicMs = this.dependencies.monotonicNow();
    const result = this.eventTail.then(async () => {
      if (this.snapshot.state.interrupted) throw new Error('本次实验已中断。');
      const source = eventName === 'music_regulation_start' ? 'html_audio_playing'
        : eventName.endsWith('video_start') || eventName === 'video_regulation_start' ? 'html_video_playing' : 'phase_transition';
      await this.dependencies.emitEvent({ runId, eventId, phaseInstanceId: `${runId}:${phase}`, eventName,
        mediaId, details, source, frontendMonotonicMs });
      if (this.snapshot.state.interrupted) throw new Error('本次实验已中断。');
    }).catch(async error => {
      if (!this.snapshot.state.interrupted) await this.fail(error);
      throw error;
    });
    this.events.set(eventId, result);
    this.eventTail = result.catch(() => {});
    return result;
  }

  private perform(name: string, action: () => Promise<boolean>): Promise<boolean> {
    if (this.operation) return this.operation.name === name ? this.operation.result : Promise.resolve(false);
    const result = Promise.resolve().then(action).finally(() => { this.operation = null; });
    this.operation = { name, result };
    return result;
  }

  recover = () => {
    this.disposed = false;
    if (!this.recoveryPending) return;
    this.recoveryPending = false;
    this.publish({ actionError: '实验页面已重新加载，本次运行已中断。请重置并创建新实验，不能补发旧标记。' });
    void this.abort().catch(error => this.publish({ actionError: describeFriendlyError(error, '关闭中断实验') }));
  };

  dispose = () => {
    this.disposed = true;
    if (this.snapshot.state.runId && this.snapshot.state.step < 5 && !this.snapshot.state.interrupted) {
      this.changeState({ interrupted: true, eventLogStatus: 'interrupted' });
      void this.abort().catch(() => {});
    }
  };

  updateDraft = (patch: Partial<Draft>) => {
    if (!this.snapshot.state.runId && !this.operation) this.changeState(patch);
  };

  startBaselineMeasurement = () => {
    if (!this.allowed(0)) return;
    const reason = setupBlockingReason(this.snapshot.state);
    if (reason) { this.publish({ actionError: reason }); return; }
    if (this.dependencies.paradigmActive()) { this.publish({ actionError: '请先结束当前实验范式。' }); return; }
    this.dependencies.subjectSelected(this.snapshot.state.subjectId.trim());
    this.publish({ actionError: null });
    this.changeState({ step: 1, runMode: this.dependencies.preferences().mode });
  };

  beginInduction = (pool: InductionPoolStatus): Promise<boolean> => {
    if (!this.allowed(1)) return Promise.resolve(false);
    if (this.snapshot.state.runId) return Promise.resolve(true);
    if (pool.kind !== 'ready') return Promise.resolve(false);
    return this.perform('begin-induction', async () => {
      this.publish({ isStartingRun: true, actionError: null });
      try {
        if (this.dependencies.paradigmActive()) throw new Error('请先结束当前实验范式。');
        const current = this.snapshot.state;
        const preferences = this.dependencies.preferences();
        const run = await this.dependencies.createRun({ ...preferences, subjectId: current.subjectId.trim(),
          userId: this.dependencies.userId(), flowKind: 'effect_evaluation', emotion: current.emotion,
          condition: current.condition, method: current.method, durationMinutes: current.durationMinutes,
          materials: [{ mediaId: pool.entry.videoId, path: pool.entry.absolutePath, phase: 'induction' }] });
        if (preferences.mode === 'formal') this.dependencies.consumeRecordingConfirmation();
        this.changeState({ runId: run.runId, runMode: preferences.mode, eventLogStatus: 'active' });
        if (this.disposed) this.changeState({ interrupted: true, eventLogStatus: 'interrupted' });
        if (this.snapshot.state.interrupted) { await this.abort().catch(() => {}); return false; }
        return true;
      } catch (error) { this.publish({ actionError: describeFriendlyError(error, '开始实验') }); return false; }
      finally { this.publish({ isStartingRun: false }); }
    });
  };

  inductionOnset = (mediaId: string): Promise<void> => {
    if (!this.allowed(1) || !this.snapshot.state.runId) return Promise.resolve();
    return this.event(`${this.snapshot.state.emotion}_video_start`, 'induction', mediaId).catch(() => {});
  };

  completeInduction = (): Promise<boolean> => {
    if (!this.allowed(1) || !this.snapshot.state.runId) return Promise.resolve(false);
    return this.perform('complete-induction', async () => {
      try {
        await this.event('induction_video_end', 'induction');
        await this.event('pre_scale_start', 'pre_scale');
        this.changeState({ step: 2 });
        return true;
      } catch { return false; }
    });
  };

  playbackError = (): Promise<void> => {
    if (![1, 3].includes(this.snapshot.state.step) || this.snapshot.state.interrupted) return Promise.resolve();
    return this.event('playback_error', 'playback_error')
      .then(() => this.fail(new Error('素材播放失败，本次实验已中断。'))).catch(() => {});
  };

  completeScaleMeasurement = (phase: ScalePhase, answers: BatteryAnswers): Promise<boolean> => {
    if (!this.allowed(phase === 'baseline' ? 2 : 4) || !this.snapshot.state.runId) return Promise.resolve(false);
    return this.perform(`scale-${phase}`, async () => {
      this.publish({ isSavingScale: true, actionError: null });
      const current = this.snapshot.state;
      try {
        if (!current.runId) return false;
        const record = await this.dependencies.saveScale(current, phase, answers);
        if (this.snapshot.state.interrupted) return false;
        await this.dependencies.linkScale(current.runId, record.id, phase);
        await this.event(phase === 'baseline' ? 'pre_scale_submit' : 'post_scale_submit', phase === 'baseline' ? 'pre_scale' : 'post_scale');
        if (phase === 'post') await this.dependencies.finishRun(current.runId, current.regulationSkipped ? 'aborted' : 'completed');
        if (this.snapshot.state.interrupted) return false;
        this.dependencies.scaleSaved(current, answers);
        this.changeState(phase === 'baseline' ? { baselineRecordId: record.id, step: 3 }
          : { postRecordId: record.id, step: 5, eventLogStatus: 'saved' });
        return true;
      } catch (error) { await this.fail(error); return false; }
      finally { this.publish({ isSavingScale: false }); }
    });
  };

  beginRegulation = (mediaId?: string, details?: unknown): Promise<void> => {
    if (!this.allowed(3) || !this.snapshot.state.runId) return Promise.resolve();
    const current = this.snapshot.state;
    if (current.regulationStartedAtMs === null) {
      this.changeState({ regulationStartedAtMs: this.dependencies.wallNow(), regulationStartedAtMonotonicMs: this.dependencies.monotonicNow() });
    }
    return this.event(current.condition === 'natural_recovery' ? 'natural_recovery_start' : `${current.method}_regulation_start`,
      'condition', mediaId, details).catch(() => {});
  };

  regulationFinishMode = () => regulationFinishModeFromRemaining(remainingRegulationSeconds(
    this.snapshot.state, this.dependencies.wallNow(), this.dependencies.monotonicNow(),
  ));

  conditionElapsed = (): Promise<void> => {
    if (!this.allowed(3) || this.regulationFinishMode().mode !== 'finish') return Promise.resolve();
    if (!this.snapshot.isWindowElapsed) this.publish({ isWindowElapsed: true });
    return this.conditionEnd().catch(() => {});
  };

  private conditionEnd() {
    const current = this.snapshot.state;
    return this.event(current.condition === 'natural_recovery' ? 'natural_recovery_end' : `${current.method}_regulation_end`, 'condition');
  }

  finishRegulation = () => this.leaveRegulation(false);
  skipRemainingRegulation = () => this.leaveRegulation(true);

  private leaveRegulation(skipped: boolean): Promise<boolean> {
    if (!this.allowed(3) || this.snapshot.state.regulationStartedAtMs === null) return Promise.resolve(false);
    if (!skipped && this.regulationFinishMode().mode !== 'finish') return Promise.resolve(false);
    return this.perform('leave-regulation', async () => {
      try {
        if (skipped) await this.event('trial_skip', 'condition_skip');
        await this.conditionEnd();
        await this.event('post_scale_start', 'post_scale');
        this.changeState({ regulationSkipped: skipped, step: 4 });
        return true;
      } catch { return false; }
    });
  }

  resetFlow = (): Promise<boolean> => this.perform('reset', async () => {
    const current = this.snapshot.state;
    try {
      if (current.runId && current.step < 5) {
        this.changeState({ interrupted: true, eventLogStatus: 'interrupted' });
        await this.abort();
        await this.eventTail;
      }
    } catch (error) {
      this.abortPromise = null;
      this.publish({ actionError: describeFriendlyError(error, '结束实验') });
      return false;
    }
    this.events.clear();
    this.eventTail = Promise.resolve();
    this.abortPromise = null;
    this.generation += 1;
    this.publish({ state: { ...createEffectEvaluationFlowState(), runMode: this.dependencies.preferences().mode },
      actionError: null, isWindowElapsed: false });
    return true;
  });

  openRegulationPage = () => this.publish({ actionError: '运行中请使用当前播放器。独立页面仅用于实验前准备素材。' });
}
