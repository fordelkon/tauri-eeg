import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { computeRegulationEffect } from '../../mentalScale/scaleRecordsApi';
import type { EffectEvaluationFlowState } from './effectEvaluationFlow';
import { EffectResultReports } from './effectResultReports';

export function useEffectResultReports(state: EffectEvaluationFlowState, userId: string | null) {
  const { runId, baselineRecordId, postRecordId } = state;
  const reports = useMemo(
    () => new EffectResultReports(baselineRecordId, postRecordId, computeRegulationEffect),
    // runId and userId are intentional rebuild keys even though the
    // constructor does not read them: a new experiment run (or signed-in
    // user) must get a fresh reports instance, never a stale cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runId, userId, baselineRecordId, postRecordId],
  );
  const snapshot = useSyncExternalStore(reports.subscribe, reports.getSnapshot);

  useEffect(() => {
    if (state.step === 5) reports.start();
    return reports.dispose;
  }, [reports, state.step]);

  return {
    clearResults: reports.clearResults,
    loadSummary: reports.loadSummary,
    summary: snapshot.kind === 'ready' ? snapshot.data : null,
    summaryError: snapshot.kind === 'failed' ? snapshot.error : null,
  };
}
