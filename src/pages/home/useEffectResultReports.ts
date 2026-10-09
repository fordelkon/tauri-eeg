import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { computeConditionEffect, computeRegulationEffect } from '../../mentalScale/scaleRecordsApi';
import type { EffectEvaluationFlowState } from './effectEvaluationFlow';
import { EffectResultReports } from './effectResultReports';

export function useEffectResultReports(state: EffectEvaluationFlowState, userId: string | null) {
  const { runId, subjectId, emotion, baselineRecordId, postRecordId } = state;
  const reports = useMemo(() => new EffectResultReports(
    { subjectId, emotion, baselineRecordId, postRecordId },
    { computeSummary: computeRegulationEffect, computeComparison: computeConditionEffect },
    // runId and userId are intentional rebuild keys even though the
    // constructor does not read them: a new experiment run (or signed-in
    // user) must get a fresh reports instance, never a stale cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [runId, userId, subjectId, emotion, baselineRecordId, postRecordId]);
  const snapshot = useSyncExternalStore(reports.subscribe, reports.getSnapshot);

  useEffect(() => {
    if (state.step === 5) reports.start();
    return reports.dispose;
  }, [reports, state.step]);

  return {
    clearResults: reports.clearResults,
    loadSummary: reports.loadSummary,
    loadConditionComparison: reports.loadConditionComparison,
    summary: snapshot.summary.kind === 'ready' ? snapshot.summary.data : null,
    summaryError: snapshot.summary.kind === 'failed' ? snapshot.summary.error : null,
    isLoadingSummary: snapshot.summary.kind === 'loading',
    conditionComparison: snapshot.comparison.kind === 'ready' ? snapshot.comparison.data : null,
    conditionComparisonError: snapshot.comparison.kind === 'failed' ? snapshot.comparison.error : null,
    isLoadingConditionComparison: snapshot.comparison.kind === 'loading',
  };
}
