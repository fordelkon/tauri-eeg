import { emitEvent, saveTrial } from '../experiment/api';
import { summarizeTrials } from './paradigmTrialSummary';
import type { ParadigmTrialPlanItem, TrialRecord, TrialSnapshot, SelfReport, TrialQuality } from './types';

export class ParadigmExperiment {
  private snapshot: TrialSnapshot | null = null;
  private trialId: string | null = null;
  private records: TrialRecord[] = [];
  private events = new Map<string, Promise<void>>();

  constructor(readonly runId: string) {}

  async event(eventName: string, source = 'paradigm_phase') {
    const key = `${this.trialId ?? this.runId}:${eventName}`;
    const phase = eventName === 'trial_start' || eventName === 'trial_end' ? 'trial'
      : eventName === 'sam_start' || eventName === 'sam_submit' ? 'sam'
      : eventName.endsWith('_video_start') || eventName === 'induction_video_end' ? 'induction'
      : eventName;
    const existing = this.events.get(key);
    if (existing) return existing;
    const pending = emitEvent({
      runId: this.runId, eventId: key, phaseInstanceId: `${this.trialId ?? this.runId}:${phase}`,
      eventName, trialId: this.trialId ?? undefined,
      mediaId: this.snapshot?.videoId, source,
      frontendMonotonicMs: performance.now(),
    }).then(() => {});
    this.events.set(key, pending);
    return pending;
  }

  async begin(plan: ParadigmTrialPlanItem) {
    this.trialId = `${this.runId}:trial:${plan.trialIndex}`;
    this.snapshot = {
      ...plan, 
      presentationStartedAt: new Date().toISOString(), presentationEndedAt: null,
    };
    await saveTrial(this.runId, { trialId: this.trialId, ...this.snapshot, presentationStatus: 'started' });
    await this.event('trial_start');
    await this.event('baseline_rest_start');
    return this.snapshot;
  }

  async end() {
    if (!this.snapshot) throw new Error('没有活动试次');
    await this.event('trial_end');
    this.snapshot = { ...this.snapshot, presentationEndedAt: new Date().toISOString() };
    await this.event('sam_start');
    return this.snapshot;
  }

  async finalize(selfReport: SelfReport | null, quality: TrialQuality, artifactFlags: string[]) {
    if (!this.snapshot || !this.trialId) throw new Error('没有活动试次');
    const record: TrialRecord = {
      ...this.snapshot, presentationEndedAt: this.snapshot.presentationEndedAt ?? new Date().toISOString(), selfReport, quality, artifactFlags,
      operatorNotes: null, labelSource: selfReport ? 'self_report_confirmed' : 'induction_target',
    };
    await saveTrial(this.runId, { trialId: this.trialId, ...record, presentationStatus: selfReport ? 'completed' : 'skipped' });
    if (selfReport) await this.event('sam_submit');
    this.records.push(record);
    this.snapshot = null;
    return record;
  }

  async interrupt(reason: string) {
    if (!this.snapshot || !this.trialId) return;
    await saveTrial(this.runId, { trialId: this.trialId, ...this.snapshot,
      presentationEndedAt: new Date().toISOString(), presentationStatus: 'interrupted', reason });
    this.snapshot = null;
  }

  summary() {
    return { ...summarizeTrials(this.records), sessionId: this.runId,
      warnings: ['质量结果依据呈现和 SAM，脑电伪迹需离线检查 BDF。'] };
  }
}


