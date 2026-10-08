import type { ParadigmSessionSummary, TrialRecord } from './types';
import { PARADIGM_EMOTIONS } from './types';

function mean(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Mirrors get_paradigm_session_summary for the locally collected records. */
export function summarizeTrials(records: TrialRecord[]): ParadigmSessionSummary {
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
    sessionId: 'pending',
    totalTrials: records.length,
    perClass,
    valenceMean: mean(records.map((r) => r.selfReport?.valence).filter((v): v is number => v != null)),
    arousalMean: mean(records.map((r) => r.selfReport?.arousal).filter((v): v is number => v != null)),
    warnings: [],
  };
}

