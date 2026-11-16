import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { createRun, emitEvent, finishRun } from '../../experiment/api';
import { consumeRecordingConfirmation, readExperimentPreferences } from '../../experiment/settings';
import { getParadigmSessionStatus } from '../../paradigm/paradigmSessionStatus';
import { buildDeqMeasurement } from '../../mentalScale/instruments/deq';
import { readStoredSubjectId, writeStoredSubjectId } from '../../storage/currentSubject';
import { savePhaseInstrumentRecord } from '../../mentalScale/scaleRecordsApi';
import {
  clearFlowStateFromStorage,
  createEffectEvaluationFlowState,
  readFlowStateFromStorage,
  writeFlowStateToStorage,
} from './effectEvaluationFlow';
import { EffectEvaluationExecution } from './effectEvaluationExecution';
import { useEffectInductionPool } from './useEffectInductionPool';
import { useEffectRegulationPool } from './useEffectRegulationPool';
import { useEffectResultReports } from './useEffectResultReports';

export function useEffectEvaluationFlow() {
  const { currentUser } = useAuth();
  const userIdRef = useRef(currentUser?.id ?? null);
  userIdRef.current = currentUser?.id ?? null;
  const [storedInitialState] = useState(() => readFlowStateFromStorage(window.sessionStorage));
  const [execution] = useState(
    () =>
      new EffectEvaluationExecution(
        storedInitialState
          ? {
              ...storedInitialState,
              runMode: storedInitialState.runId
                ? storedInitialState.runMode
                : readExperimentPreferences().mode,
            }
          : {
              ...createEffectEvaluationFlowState(),
              subjectId: readStoredSubjectId(),
              runMode: readExperimentPreferences().mode,
            },
        {
          createRun,
          emitEvent,
          finishRun,
          preferences: readExperimentPreferences,
          consumeRecordingConfirmation,
          userId: () => userIdRef.current,
          paradigmActive: () => getParadigmSessionStatus().active,
          subjectSelected: writeStoredSubjectId,
          wallNow: Date.now,
          monotonicNow: () => performance.now(),
          saveScale: async (current, phase, answers) => {
            if (!current.runId) throw new Error('缺少本次实验编号，无法保存评分。');
            return savePhaseInstrumentRecord({
              userId: userIdRef.current,
              experimentRunId: current.runId,
              subjectId: current.subjectId.trim(),
              phase,
              ...buildDeqMeasurement(answers),
              emotion: current.emotion,
              condition: current.condition,
              durationMinutes: current.durationMinutes,
              regulationSkipped: phase === 'post' ? current.regulationSkipped : false,
            });
          },
        },
        storedInitialState !== null,
      ),
  );
  const snapshot = useSyncExternalStore(execution.subscribe, execution.getSnapshot);
  const { state } = snapshot;
  // state.runId is an intentional rebuild key: the playback binding must be
  // re-created per experiment run even though the callback body reads nothing
  // from it directly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const playback = useMemo(() => execution.bindPlayback(), [execution, state.runId]);
  const { inductionStatus, isInductionPoolLoading } = useEffectInductionPool(
    state.emotion,
    state.step,
  );
  const { isRegulationPoolLoading, regulationPoolStatus } = useEffectRegulationPool(
    state.condition === 'regulation' && state.method === 'video',
    state.step,
  );
  const resultReports = useEffectResultReports(state, currentUser?.id ?? null);

  useEffect(() => {
    writeFlowStateToStorage(window.sessionStorage, state);
  }, [state]);
  useEffect(() => {
    execution.recover();
    return execution.dispose;
  }, [execution]);

  const beginInduction = useCallback(
    () => execution.beginInduction(inductionStatus),
    [execution, inductionStatus],
  );
  const resetFlow = useCallback(async () => {
    if (await execution.resetFlow()) {
      resultReports.clearResults();
      clearFlowStateFromStorage(window.sessionStorage);
      return true;
    }
    return false;
  }, [execution, resultReports]);

  return {
    ...resultReports,
    ...snapshot,
    beginInduction,
    resetFlow,
    inductionStatus,
    isInductionPoolLoading,
    isRegulationPoolLoading,
    regulationPoolStatus,
    isResumedRun: storedInitialState !== null && storedInitialState.runId !== null,
    ...playback,
    completeScaleMeasurement: execution.completeScaleMeasurement,
    finishRegulation: execution.finishRegulation,
    skipRemainingRegulation: execution.skipRemainingRegulation,
    regulationFinishMode: execution.regulationFinishMode,
    openRegulationPage: execution.openRegulationPage,
    startBaselineMeasurement: execution.startBaselineMeasurement,
    updateDraft: execution.updateDraft,
  };
}
export type EffectEvaluationFlow = ReturnType<typeof useEffectEvaluationFlow>;
