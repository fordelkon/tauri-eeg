/**
 * Frontend-only stand-ins for the paradigm IPC commands, used when the setup
 * panel runs in 试运行 (dry-run) mode: no device connections, no files on
 * disk, no database rows. Shapes mirror the backend contract one-to-one so
 * the runner and summary screens behave exactly like a real session.
 */
import type {
  ParadigmSessionSummary,
  ParadigmTrialPlanItem,
  SelfReport,
  TrialMarkKind,
  TrialQuality,
  TrialRecord,
  TrialSnapshot,
} from './types';
import { PARADIGM_EMOTIONS } from './types';

export function makeDryRunSnapshot(plan: ParadigmTrialPlanItem): TrialSnapshot {
  const now = new Date().toISOString();

  return {
    trialIndex: plan.trialIndex,
    emotion: plan.emotion,
    triggerClass: plan.triggerClass,
    videoId: plan.videoId,
    videoPath: plan.videoPath,
    eegStartSampleIndex: 0,
    eegStartTs: now,
    eegEndSampleIndex: null,
    eegEndTs: null,
    marks: [],
    hardwareTriggers: [],
    triggerStartTs: null,
    triggerEndTs: null,
  };
}

export function appendDryRunMark(snapshot: TrialSnapshot, mark: TrialMarkKind): TrialSnapshot {
  return {
    ...snapshot,
    marks: [
      ...snapshot.marks,
      { mark, sampleIndex: 0, timestamp: new Date().toISOString() },
    ],
  };
}

export function endDryRunSnapshot(snapshot: TrialSnapshot): TrialSnapshot {
  const now = new Date().toISOString();

  return {
    ...snapshot,
    eegEndSampleIndex: 0,
    eegEndTs: now,
  };
}

export function makeDryRunTrialRecord(
  snapshot: TrialSnapshot,
  selfReport: SelfReport,
  quality: TrialQuality,
  artifactFlags: string[],
  operatorNotes: string | null,
): TrialRecord {
  return {
    ...snapshot,
    selfReport,
    quality,
    artifactFlags,
    operatorNotes,
    labelSource: 'self_report_confirmed',
  };
}

function mean(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Mirrors get_paradigm_session_summary for the locally collected records. */
export function summarizeDryRunTrials(records: TrialRecord[]): ParadigmSessionSummary {
  const perClass = PARADIGM_EMOTIONS
    .map((emotion) => ({
      emotion,
      accepted: records.filter((r) => r.emotion === emotion && r.quality === 'accepted').length,
      uncertain: records.filter((r) => r.emotion === emotion && r.quality === 'uncertain').length,
      rejected: records.filter((r) => r.emotion === emotion && r.quality === 'rejected').length,
      artifactRejected: records.filter((r) => r.emotion === emotion && r.quality === 'artifact_rejected').length,
      interrupted: 0,
    }))
    .filter((row) => (
      row.accepted + row.uncertain + row.rejected + row.artifactRejected + row.interrupted > 0
    ));

  return {
    sessionId: 'dry-run',
    totalTrials: records.length,
    perClass,
    valenceMean: mean(records.map((r) => r.selfReport?.valence).filter((v): v is number => v != null)),
    arousalMean: mean(records.map((r) => r.selfReport?.arousal).filter((v): v is number => v != null)),
    warnings: [],
  };
}
