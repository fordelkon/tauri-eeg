import { useCallback, useEffect, useState } from 'react';
import {
  computeConditionEffect,
  computeRegulationEffect,
  type ConditionEffectComparisonView,
  type RegulationEffectSummaryView,
} from '../../mentalScale/scaleRecordsApi';
import { describeFriendlyError } from '../../ui/friendlyError';
import { describeMissingMeasurements, type EffectEvaluationFlowState } from './effectEvaluationFlow';

/**
 * Result-step data for the effect-evaluation wizard: the in-run summary
 * (baseline vs post improvement, guarded on both measurements existing) and
 * the cross-condition comparison (R6, 大纲 6.2 — pairs this subject+emotion's
 * latest complete run of each condition). Both load automatically when the
 * result step becomes visible and expose retry loaders for their error
 * banners.
 */
export function useEffectResultReports(state: EffectEvaluationFlowState) {
  const [summary, setSummary] = useState<RegulationEffectSummaryView | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  // Cross-condition comparison (R6, 大纲 6.2): regulation vs natural-recovery
  // runs of the same subject+emotion; independent of the in-run summary.
  const [conditionComparison, setConditionComparison] = useState<ConditionEffectComparisonView | null>(null);
  const [conditionComparisonError, setConditionComparisonError] = useState<string | null>(null);
  const [isLoadingConditionComparison, setIsLoadingConditionComparison] = useState(false);

  const loadSummary = useCallback(async () => {
    const missingCopy = describeMissingMeasurements(state);

    if (missingCopy) {
      setSummary(null);
      setSummaryError(missingCopy);
      return;
    }

    const baselineRecordId = state.baselineRecordId!;
    const postRecordId = state.postRecordId!;

    setIsLoadingSummary(true);
    setSummaryError(null);

    try {
      setSummary(await computeRegulationEffect(baselineRecordId, postRecordId));
    } catch (error) {
      setSummaryError(describeFriendlyError(error, '计算调控效果'));
    } finally {
      setIsLoadingSummary(false);
    }
  }, [state.baselineRecordId, state.postRecordId]);

  // Auto-load the summary when the result step becomes visible.
  useEffect(() => {
    if (state.step === 5 && !summary && !summaryError && !isLoadingSummary) {
      void loadSummary();
    }
  }, [isLoadingSummary, loadSummary, state.step, summary, summaryError]);

  /**
   * Pairs this subject+emotion's latest complete run of each condition and
   * computes the regulation condition's improvement relative to the
   * natural-recovery baseline. Errors when either condition has no complete
   * run yet - the result step renders that as guidance instead of a hard
   * failure.
   */
  const loadConditionComparison = useCallback(async () => {
    setIsLoadingConditionComparison(true);
    setConditionComparisonError(null);

    try {
      setConditionComparison(
        await computeConditionEffect(state.subjectId.trim(), state.emotion),
      );
    } catch (error) {
      setConditionComparisonError(describeFriendlyError(error, '计算跨条件对比'));
    } finally {
      setIsLoadingConditionComparison(false);
    }
  }, [state.emotion, state.subjectId]);

  // Auto-load the comparison next to the in-run summary on the result step.
  useEffect(() => {
    if (
      state.step === 5
      && !conditionComparison
      && !conditionComparisonError
      && !isLoadingConditionComparison
    ) {
      void loadConditionComparison();
    }
  }, [
    conditionComparison,
    conditionComparisonError,
    isLoadingConditionComparison,
    loadConditionComparison,
    state.step,
  ]);

  // The reset path clears both reports so a discarded run cannot leak its
  // summary/comparison into the next run's result step (the auto-load effects
  // only fire when nothing is loaded yet).
  const clearResults = useCallback(() => {
    setSummary(null);
    setSummaryError(null);
    setConditionComparison(null);
    setConditionComparisonError(null);
    setIsLoadingSummary(false);
    setIsLoadingConditionComparison(false);
  }, []);

  return {
    clearResults,
    conditionComparison,
    conditionComparisonError,
    isLoadingConditionComparison,
    isLoadingSummary,
    loadConditionComparison,
    loadSummary,
    summary,
    summaryError,
  };
}
