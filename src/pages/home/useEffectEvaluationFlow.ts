import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { createRun, emitEvent, finishRun, linkScale } from '../../experiment/api';
import { consumeRecordingConfirmation, readExperimentPreferences } from '../../experiment/settings';
import { getParadigmSessionStatus } from '../../paradigm/paradigmSessionStatus';
import {
  buildBatteryMentalScaleStatus,
  updateMentalScaleStatus,
} from '../../mentalScale/mentalScaleStatus';
import {
  STAI_PANAS_BATTERY_SCALE_ID,
  batteryDimensionKeys,
  buildBatteryDefinition,
  buildBatteryRawAnswers,
  computeBatteryDimensions,
} from '../../mentalScale/instruments/battery';
import { recordScaleCompletion } from '../../mentalScale/scaleCompletion';
import { readStoredSubjectId, writeStoredSubjectId } from '../../storage/currentSubject';
import { savePhaseInstrumentRecord, type ScalePhase } from '../../mentalScale/scaleRecordsApi';
import {
  clearFlowStateFromStorage,
  createEffectEvaluationFlowState,
  readFlowStateFromStorage,
  regulationPathForMethod,
  writeFlowStateToStorage,
} from './effectEvaluationFlow';
import { EffectEvaluationExecution } from './effectEvaluationExecution';
import { useEffectInductionPool } from './useEffectInductionPool';
import { useEffectRegulationPool } from './useEffectRegulationPool';
import { useEffectResultReports } from './useEffectResultReports';

const BASELINE_SCALE_DEFINITION = buildBatteryDefinition({ includeSam: true });

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
          linkScale,
          preferences: readExperimentPreferences,
          consumeRecordingConfirmation,
          userId: () => userIdRef.current,
          paradigmActive: () => getParadigmSessionStatus().active,
          subjectSelected: writeStoredSubjectId,
          wallNow: Date.now,
          monotonicNow: () => performance.now(),
          saveScale: async (current, phase, answers) => {
            const dimensionScores = computeBatteryDimensions(answers.stai, answers.panas);
            return await savePhaseInstrumentRecord({
              userId: userIdRef.current,
              subjectId: current.subjectId.trim(),
              scaleId: STAI_PANAS_BATTERY_SCALE_ID,
              phase,
              dimensionScores,
              rawAnswers: buildBatteryRawAnswers(answers),
              measuredDimensions: [...batteryDimensionKeys],
              emotion: current.emotion,
              condition: current.condition,
              durationMinutes: current.durationMinutes,
              regulationSkipped: phase === 'post' ? current.regulationSkipped : false,
            });
          },
          scaleSaved: (current, answers) => {
            updateMentalScaleStatus(
              buildBatteryMentalScaleStatus(computeBatteryDimensions(answers.stai, answers.panas)),
            );
            recordScaleCompletion(regulationPathForMethod(current.method));
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

  const postScaleDefinition = useMemo(
    () =>
      buildBatteryDefinition({
        includeGems: state.method === 'music' && state.condition === 'regulation',
      }),
    [state.method, state.condition],
  );
  const scaleDefinitionFor = useCallback(
    (phase: ScalePhase) => (phase === 'baseline' ? BASELINE_SCALE_DEFINITION : postScaleDefinition),
    [postScaleDefinition],
  );
  const beginInduction = useCallback(
    () => execution.beginInduction(inductionStatus),
    [execution, inductionStatus],
  );
  const resetFlow = useCallback(async () => {
    if (await execution.resetFlow()) {
      resultReports.clearResults();
      clearFlowStateFromStorage(window.sessionStorage);
    }
  }, [execution, resultReports]);

  return {
    ...resultReports,
    ...snapshot,
    beginInduction,
    resetFlow,
    scaleDefinitionFor,
    inductionStatus,
    isInductionPoolLoading,
    isRegulationPoolLoading,
    regulationPoolStatus,
    isResumedRun: storedInitialState !== null,
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
