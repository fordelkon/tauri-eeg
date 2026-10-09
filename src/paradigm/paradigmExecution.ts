import { finishRun } from '../experiment/api';
import { evaluateParadigmAcceptance } from './paradigmAcceptance';
import { describeParadigmQueueProgress } from './paradigmBlockQueue';
import { ParadigmExperiment } from './paradigmExperiment';
import { toLibraryErrorMessage } from './paradigmSessionKinds';
import {
  initialParadigmSessionState,
  paradigmSessionReducer,
  type ParadigmSessionAction,
  type ParadigmSessionState,
} from './paradigmSessionState';
import { isVideoDurationOutOfRange } from './paradigmTimeline';
import type {
  ParadigmSessionKind,
  ParadigmSessionSummary,
  ParadigmTrialPlanItem,
  SelfReport,
} from './types';

type Operation = 'idle' | 'begin' | 'end' | 'finalize' | 'skip' | 'complete';
export type TrialCallbackToken = Pick<
  ParadigmSessionState,
  'phase' | 'trialPhase' | 'currentTrialIndex'
>;
export type ParadigmExecutionSnapshot = {
  state: ParadigmSessionState;
  operation: Operation;
  blockGate: number;
  summary: ParadigmSessionSummary | null;
  summaryError: string | null;
};

export class ParadigmExecution {
  private experiment: ParadigmExperiment;
  private listeners = new Set<() => void>();
  private stopped = false;
  private started = false;
  private videoStarted = false;
  private videoEndMarked = false;
  private videoErrorMarked = false;
  private videoDuration: number | null = null;
  private pending: Promise<void> = Promise.resolve();
  private termination: Promise<void> | null = null;
  private snapshot: ParadigmExecutionSnapshot = {
    state: initialParadigmSessionState,
    operation: 'idle',
    blockGate: -1,
    summary: null,
    summaryError: null,
  };

  constructor(
    private request: {
      runId: string;
      queue: ParadigmTrialPlanItem[];
      sessionKind: ParadigmSessionKind;
    },
  ) {
    this.experiment = new ParadigmExperiment(request.runId);
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(patch: Partial<ParadigmExecutionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private transition(action: ParadigmSessionAction) {
    const state = paradigmSessionReducer(this.snapshot.state, action);
    if (state !== this.snapshot.state) this.publish({ state });
  }

  start = () => {
    if (this.started) return;
    this.started = true;
    this.transition({ type: 'enter_setup' });
    this.transition({
      type: 'session_started',
      queue: this.request.queue,
      sessionKind: this.request.sessionKind,
    });
    this.transition({ type: 'session_id_resolved', sessionId: this.request.runId });
    this.reconcile();
  };

  exitSession = () => this.transition({ type: 'end_session' });

  setBlockGate = (blockGate: number) => {
    this.publish({ blockGate });
    this.reconcile();
  };

  private current(token: TrialCallbackToken) {
    const state = this.snapshot.state;
    return (
      !this.stopped &&
      state.phase === 'running' &&
      token.phase === state.phase &&
      token.currentTrialIndex === state.currentTrialIndex &&
      token.trialPhase === state.trialPhase
    );
  }

  private execute(operation: Exclude<Operation, 'idle'>, task: () => Promise<void>) {
    if (this.stopped || this.snapshot.operation !== 'idle') return this.pending;
    this.publish({ operation });
    this.pending = task()
      .catch((error: unknown) => {
        if (operation === 'complete') this.publish({ summaryError: toLibraryErrorMessage(error) });
        this.fail(error);
      })
      .finally(() => {
        this.publish({ operation: 'idle' });
        this.reconcile();
      });
    return this.pending;
  }

  private fail(error: unknown) {
    if (this.stopped) return;
    const reason = toLibraryErrorMessage(error);
    void this.terminate(reason, reason, reason).catch(() => {});
  }

  private terminate(message: string, reason: string, finishReason?: string) {
    if (this.termination) return this.termination;
    this.stopped = true;
    this.experiment.stop();
    this.transition({ type: 'session_failed', message });
    const pending = this.pending;
    this.termination = pending.then(async () => {
      try {
        await this.experiment.interrupt(reason);
      } finally {
        await finishRun(this.request.runId, 'aborted', finishReason);
      }
    });
    return this.termination;
  }

  abort = () => this.terminate('实验已中止', '操作者提前结束');

  private reconcile() {
    if (this.stopped || this.snapshot.operation !== 'idle') return;
    const state = this.snapshot.state;
    if (state.phase === 'finished' && !this.snapshot.summary) {
      void this.execute('complete', async () => {
        await finishRun(this.request.runId, 'completed');
        if (!this.stopped) this.publish({ summary: this.experiment.summary() });
      });
      return;
    }
    if (state.phase !== 'running') return;
    if (state.trialPhase === 'interTrial') {
      const progress = describeParadigmQueueProgress(
        state.queue,
        state.currentTrialIndex,
        this.snapshot.blockGate,
      );
      const plan = state.queue[progress.nextTrialIndex];
      if (!plan || progress.awaitingBlockGate) return;
      void this.execute('begin', async () => {
        await this.experiment.begin(plan);
        if (this.stopped) return;
        this.videoStarted = false;
        this.videoEndMarked = false;
        this.videoErrorMarked = false;
        this.videoDuration = null;
        this.transition({ type: 'trial_started', trialIndex: plan.trialIndex });
      });
    } else if (state.trialPhase === 'qualityCheck' && state.selfReport) {
      const selfReport = state.selfReport;
      const flags =
        this.videoDuration !== null && isVideoDurationOutOfRange(this.videoDuration)
          ? ['video_duration_out_of_range']
          : [];
      const quality = flags.length ? 'artifact_rejected' : (state.suggestedQuality ?? 'accepted');
      void this.execute('finalize', async () => {
        await this.experiment.finalize(selfReport, quality, flags);
        if (!this.stopped) this.transition({ type: 'trial_finalized' });
      });
    }
  }

  private mark(event: string, source?: string) {
    return this.experiment.event(event, source).catch((error: unknown) => this.fail(error));
  }

  videoFirstPlay(token: TrialCallbackToken) {
    if (!this.current(token) || token.trialPhase !== 'video' || this.videoStarted) return;
    const plan = this.snapshot.state.queue[token.currentTrialIndex];
    if (!plan) return;
    this.videoStarted = true;
    return this.mark(`${plan.emotion}_video_start`, 'html_video_playing');
  }

  videoEnded(token: TrialCallbackToken) {
    if (!this.current(token) || token.trialPhase !== 'video' || this.videoEndMarked) return;
    this.videoEndMarked = true;
    return this.mark('induction_video_end', 'html_video_ended').then(() => {
      if (this.current(token) && this.snapshot.operation === 'idle') this.advance();
    });
  }

  videoError(token: TrialCallbackToken) {
    // Defense in depth against duplicate callers: `playback_error` is a
    // research-data event, so it must be recorded at most once per video
    // phase (VideoStage already reports one-shot).
    if (!this.current(token) || this.videoErrorMarked) return;
    this.videoErrorMarked = true;
    return this.mark('playback_error', 'video_error');
  }

  videoDurationLoaded(token: TrialCallbackToken, seconds: number | null) {
    if (this.current(token)) this.videoDuration = seconds;
  }

  private advance() {
    this.transition({ type: 'advance_trial_phase' });
    const phase = this.snapshot.state.trialPhase;
    if (phase === 'hint') void this.mark('hint_start');
    if (phase === 'postRest') void this.mark('post_rest_start');
  }

  countdownComplete(token: TrialCallbackToken) {
    if (!this.current(token) || this.snapshot.operation !== 'idle') return;
    if (token.trialPhase === 'postRest') {
      return this.execute('end', async () => {
        await this.experiment.end();
        if (this.current(token)) this.transition({ type: 'trial_ended' });
      });
    }
    this.advance();
  }

  selfReportSubmit(token: TrialCallbackToken, selfReport: SelfReport) {
    if (!this.current(token) || this.snapshot.operation !== 'idle') return;
    const plan = this.snapshot.state.queue[token.currentTrialIndex];
    if (!plan) return;
    this.transition({
      type: 'self_report_submitted',
      selfReport,
      suggestedQuality: evaluateParadigmAcceptance(
        plan.emotion,
        selfReport.valence,
        selfReport.arousal,
      ),
    });
    this.reconcile();
  }

  async skip(token: TrialCallbackToken, confirm: () => Promise<boolean>) {
    if (!this.current(token) || this.snapshot.operation !== 'idle') return;
    if (!(await confirm()) || !this.current(token) || this.snapshot.operation !== 'idle') return;
    return this.execute('skip', async () => {
      await this.experiment.event('playback_error', 'video_error');
      await this.experiment.event('trial_skip');
      await this.experiment.event('trial_end');
      if (this.stopped) return;
      await this.experiment.finalize(null, 'rejected', ['video_playback_failure']);
      if (this.current(token)) this.transition({ type: 'trial_skipped' });
    });
  }
}
