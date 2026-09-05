import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useEegSession } from '../../eeg/EegSessionContext';
import { getParadigmSessionStatus } from '../../eeg/paradigm/paradigmSessionStatus';
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
  type BatteryAnswers,
} from '../../mentalScale/instruments/battery';
import { recordScaleCompletion } from '../../mentalScale/scaleCompletion';
import { readStoredSubjectId, writeStoredSubjectId } from '../../storage/currentSubject';
import { savePhaseInstrumentRecord, type ScalePhase } from '../../mentalScale/scaleRecordsApi';
import { describeFriendlyError } from '../../ui/friendlyError';
import {
  clearFlowStateFromStorage,
  createEffectEvaluationFlowState,
  isRegulationWindowOpen,
  readFlowStateFromStorage,
  regulationPathForMethod,
  setupBlockingReason,
  writeFlowStateToStorage,
  type EffectEvaluationFlowState,
} from './effectEvaluationFlow';
import { useEffectInductionPool } from './useEffectInductionPool';
import { useEffectResultReports } from './useEffectResultReports';

/**
 * React wiring for the effect-evaluation wizard (R6: 设置 -> 情绪诱发 ->
 * 诱发后量表 -> 条件执行 -> 条件后量表 -> 结果评价). All step gating,
 * countdown math, and copy decisions live in the pure `effectEvaluationFlow`
 * module; this hook only bridges it to React state, Tauri persistence,
 * navigation, and the EEG recording context. The induction video pool and
 * the result-step reports load through their own focused hooks.
 *
 * The whole state is mirrored into sessionStorage so jumping to the music/
 * video regulation page (which unmounts this route) and coming back resumes
 * the same run with a wall-clock countdown. Only the 调控 condition jumps;
 * the 自然恢复 (基线) condition runs its countdown inside this page.
 *
 * Render-cost contract: this hook owns NO wall-clock interval. The condition
 * window's 500ms tick lives entirely inside the self-contained
 * ConditionCountdown leaf (which reads the clock and reports expiry upward),
 * so hook consumers re-render only on real state changes — never per tick.
 */

function readStoredFlowState(): EffectEvaluationFlowState | null {
  return readFlowStateFromStorage(window.sessionStorage);
}

function writeStoredFlowState(state: EffectEvaluationFlowState): void {
  writeFlowStateToStorage(window.sessionStorage, state);
}

function clearStoredFlowState(): void {
  clearFlowStateFromStorage(window.sessionStorage);
}

/**
 * Node ② baseline battery (doc scale-instruments.md §3.3): the shared
 * STAI-S + PANAS battery with the SAM manipulation-check section prepended;
 * its answers ride the baseline record as raw_answers.sam. Pure data, so it
 * is built once at module load.
 */
const BASELINE_SCALE_DEFINITION = buildBatteryDefinition({ includeSam: true });

export function useEffectEvaluationFlow() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { canStartRecord, lastRecording, startRecord, stopRecord } = useEegSession();

  // Read the persisted payload once, before the first render commits: a
  // non-null value means THIS mount resumed an in-flight run (mid-run reload
  // or the return trip from the standalone regulation page). The page turns
  // that into an explicit "已恢复" notice instead of silently dropping the
  // operator onto a mid-flow step.
  const [storedInitialState] = useState<EffectEvaluationFlowState | null>(
    () => readStoredFlowState(),
  );
  const [state, setState] = useState<EffectEvaluationFlowState>(
    () => storedInitialState ?? {
      ...createEffectEvaluationFlowState(),
      // Subject handoff (ParadigmRunner finished screen → wizard): the
      // paradigm setup panel validated and stored the subject id, so a fresh
      // run starts pre-filled from the shared memory (still editable; a
      // resumed run keeps its stored binding untouched).
      subjectId: readStoredSubjectId(),
    },
  );
  const [isSavingScale, setIsSavingScale] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Induction-step video pool + result-step reports load through their own
  // focused hooks; both expose loading flags and retry loaders to the page.
  const { inductionStatus, isInductionPoolLoading } = useEffectInductionPool(state.emotion, state.step);
  const resultReports = useEffectResultReports(state);
  // Set when this flow started the EEG recording and still expects its session
  // id; a ref because stopRecord resolves before the context publishes the row.
  const awaitingSessionIdRef = useRef(false);
  // Latest association status for callbacks that must act on it synchronously
  // (the reset path) without waiting for a re-render.
  const eegAssociationRef = useRef(state.eegAssociation);
  // Latest full state for the unmount safety net: the designed jump to the
  // regulation page may keep the recording alive only while the regulation
  // condition's window itself is open.
  const flowStateRef = useRef(state);
  // Bumped whenever the run is discarded; an in-flight EEG start from an
  // earlier generation must not mark the fresh run as recording (and must
  // stop the recording it just created) — otherwise a reset clicked while
  // startRecord was pending leaks an unowned recording (R4/F3).
  const flowGenerationRef = useRef(0);

  useEffect(() => {
    flowStateRef.current = state;
    writeStoredFlowState(state);
  }, [state]);

  useEffect(() => {
    eegAssociationRef.current = state.eegAssociation;
  }, [state.eegAssociation]);

  // Capture the EEG session id once the backend confirms the stopped recording.
  useEffect(() => {
    if (!awaitingSessionIdRef.current || !lastRecording?.id) {
      return;
    }

    awaitingSessionIdRef.current = false;
    setState((current) => (
      current.eegSessionId === lastRecording.id
        ? current
        : { ...current, eegSessionId: lastRecording.id, eegAssociation: 'saved' }
    ));
  }, [lastRecording?.id]);

  // Latest method for callbacks that must act on it synchronously (the
  // unmount safety net below) without waiting for a re-render.
  const methodRef = useRef(state.method);

  useEffect(() => {
    methodRef.current = state.method;
  }, [state.method]);

  // Unmount safety net (R4/F3): the recording is allowed to outlive this
  // component only for the designed jump to the run's regulation page while
  // the regulation condition's window is live. Any other unmount mid-recording
  // (e.g. leaving through the sidebar, or wandering off during the induction
  // leg) would leak an unowned recording that nobody can stop or associate
  // anymore.
  useEffect(() => {
    return () => {
      if (eegAssociationRef.current !== 'recording') {
        return;
      }

      const isDesignedJump = window.location.pathname === regulationPathForMethod(methodRef.current)
        && flowStateRef.current.condition === 'regulation'
        && isRegulationWindowOpen(flowStateRef.current);

      if (!isDesignedJump) {
        eegAssociationRef.current = 'unavailable';
        awaitingSessionIdRef.current = false;
        void stopRecord();
      }
    };
  }, [stopRecord]);

  /**
   * The pre/post measurement instrument (doc scale-instruments.md §1): the
   * same STAI-S + PANAS battery for nodes ②/④ of every run, deliberately
   * independent of the regulation method so cross-method comparison keeps one
   * metric basis. Optional sections ride the same battery record (doc §3.3):
   * the SAM manipulation check joins the baseline leg (node ②), and GEMS-9
   * joins the post leg (node ④) only for the music REGULATION condition — the
   * natural-recovery arm never plays music, so asking music-emotion questions
   * there would measure nothing (and would break the manipulation-check
   * semantics of the instrument).
   */
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

  const updateDraft = useCallback((
    patch: Partial<Pick<
      EffectEvaluationFlowState,
      'subjectId' | 'emotion' | 'method' | 'condition' | 'durationMinutes'
    >>,
  ) => {
    setState((current) => ({ ...current, ...patch }));
  }, []);

  /** Step 0 → 1: validates the subject binding before any measurement. */
  const startBaselineMeasurement = useCallback(() => {
    setActionError(null);

    const reason = setupBlockingReason(state);
    if (reason) {
      setActionError(reason);
      return;
    }

    // Share the validated binding with the rest of the app: standalone gate
    // submissions made during/after this run inherit the same subject instead
    // of persisting null (same memory the paradigm setup panel writes).
    writeStoredSubjectId(state.subjectId.trim());

    setState((current) => ({ ...current, step: 1 }));
  }, [state]);

  /**
   * Best-effort EEG start shared by the induction and condition-execution
   * entries (R6: 诱发期间可开 EEG 录制，沿用现有逻辑). An unavailable device
   * degrades to `unavailable` - never blocks the loop.
   */
  const startEegAssociation = useCallback(() => {
    if (!canStartRecord || !currentUser) {
      eegAssociationRef.current = 'unavailable';
      setState((current) => ({ ...current, eegAssociation: 'unavailable' }));
      return;
    }

    const generation = flowGenerationRef.current;
    void startRecord()
      .then((started) => {
        if (flowGenerationRef.current !== generation) {
          // The run was reset while this start was in flight: the recording
          // (if it came up) belongs to nobody now - stop it immediately
          // instead of leaking it into the fresh run.
          if (started) {
            void stopRecord();
          }
          return;
        }

        eegAssociationRef.current = started ? 'recording' : 'unavailable';
        awaitingSessionIdRef.current = started;
        setState((current) => (
          started
            ? { ...current, eegAssociation: 'recording' }
            : { ...current, eegAssociation: 'unavailable' }
        ));
      })
      .catch(() => {
        if (flowGenerationRef.current !== generation) {
          return;
        }

        eegAssociationRef.current = 'unavailable';
        setState((current) => ({ ...current, eegAssociation: 'unavailable' }));
      });
  }, [canStartRecord, currentUser, startRecord, stopRecord]);

  /**
   * Step 1 entry: the page opens the induction video and calls this to
   * associate an EEG free recording spanning the whole run (induction through
   * the condition window; stopped when leaving the condition step).
   */
  const beginInduction = useCallback(() => {
    setActionError(null);

    if (getParadigmSessionStatus().active) {
      setActionError('范式 Session 进行中，请先结束范式采集再开始情绪诱发。');
      return;
    }

    startEegAssociation();
  }, [startEegAssociation]);

  /** Step 1 -> 2: the induction video played to its end. */
  const completeInduction = useCallback(() => {
    setActionError(null);
    setState((current) => ({ ...current, step: 2 }));
  }, []);

  /**
   * Steps 2/4: persists one battery submission (scale_id
   * 'stai_panas_battery_v1', doc scale-instruments.md §3.3) under this run's
   * subject, phase, and condition, mirrors the computed dimensions into the
   * in-memory status cache and the run's regulation path into the gate cache
   * exactly like the standalone gate flow (so walking into the regulation
   * page mid-loop does not re-prompt the gate), then advances.
   */
  const completeScaleMeasurement = useCallback(async (
    phase: ScalePhase,
    answers: BatteryAnswers,
  ) => {
    if (isSavingScale) {
      return;
    }

    setIsSavingScale(true);
    setActionError(null);

    try {
      // Battery scoring is pure and polarity-normalized (doc §3.2): the
      // stored dimension_scores are already lower=better.
      const dimensionScores = computeBatteryDimensions(answers.stai, answers.panas);
      const record = await savePhaseInstrumentRecord({
        userId: currentUser?.id ?? null,
        subjectId: state.subjectId.trim(),
        scaleId: STAI_PANAS_BATTERY_SCALE_ID,
        phase,
        dimensionScores,
        rawAnswers: buildBatteryRawAnswers(answers),
        // The dialog requires every displayed question (including the optional
        // SAM/GEMS sections), so every battery dimension is genuinely
        // measured (R4/F1).
        measuredDimensions: [...batteryDimensionKeys],
        emotion: state.emotion,
        condition: state.condition,
        durationMinutes: state.durationMinutes,
        // The skip marker only exists once the regulation leg ran; it rides
        // on the post record so reports/history can flag under-timed runs.
        regulationSkipped: phase === 'post' ? state.regulationSkipped : false,
        // The EEG association is persisted on the post record (R4/F2) so the
        // effect verdict links back to its neural data across restarts.
        eegSessionId: phase === 'post' ? state.eegSessionId : null,
      });

      updateMentalScaleStatus(buildBatteryMentalScaleStatus(dimensionScores));
      recordScaleCompletion(regulationPathForMethod(state.method));

      setState((current) => (
        phase === 'baseline'
          ? { ...current, baselineRecordId: record.id, step: 3 }
          : { ...current, postRecordId: record.id, step: 5 }
      ));
    } catch (error) {
      setActionError(describeFriendlyError(error, '保存量表记录'));
    } finally {
      setIsSavingScale(false);
    }
  }, [
    currentUser?.id,
    isSavingScale,
    state.condition,
    state.durationMinutes,
    state.eegSessionId,
    state.emotion,
    state.method,
    state.regulationSkipped,
    state.subjectId,
  ]);

  /**
   * Step 3 entry: opens the wall-clock window (the countdown leaf reads its
   * own clock from the stamped start; this hook never polls). The EEG side
   * either keeps the recording already running since the induction step, or
   * starts one now (device was unavailable at induction, or a legacy resumed
   * run). A live paradigm session blocks the entry as before.
   */
  const beginRegulation = useCallback(() => {
    setActionError(null);

    if (getParadigmSessionStatus().active) {
      setActionError('范式 Session 进行中，请先结束范式采集再开始条件执行。');
      return;
    }

    setState((current) => ({
      ...current,
      regulationStartedAtMs: Date.now(),
      eegAssociation: current.eegAssociation === 'saved'
        ? 'saved'
        : current.eegAssociation === 'recording' ? 'recording' : 'not-started',
    }));

    // A recording started at the induction step already spans this window.
    if (eegAssociationRef.current === 'recording') {
      return;
    }

    startEegAssociation();
  }, [startEegAssociation]);

  /**
   * Step 3 exit shared by the normal finish and the confirmed skip: stops
   * the associated recording (when one is live), then moves to the post
   * scale. `extraPatch` carries markers such as the skip flag.
   */
  const leaveRegulationStep = useCallback(async (
    extraPatch?: Partial<Pick<EffectEvaluationFlowState, 'regulationSkipped'>>,
  ) => {
    setActionError(null);

    if (state.eegAssociation !== 'recording') {
      awaitingSessionIdRef.current = false;
      setState((current) => ({ ...current, ...extraPatch, step: 4 }));
      return;
    }

    // Re-arm the capture even on a resumed run (the ref does not survive the
    // remount after jumping to the regulation page).
    awaitingSessionIdRef.current = true;
    const stopped = await stopRecord();
    eegAssociationRef.current = stopped ? 'saved' : 'unavailable';

    if (!stopped) {
      // No session row will arrive; don't leave the watcher armed for an
      // unrelated future recording.
      awaitingSessionIdRef.current = false;
    }
    // On success the session id lands via the watcher effect above.
    setState((current) => ({
      ...current,
      ...extraPatch,
      step: 4,
      eegAssociation: stopped ? 'saved' : 'unavailable',
    }));
  }, [state.eegAssociation, stopRecord]);

  /** Normal exit — the UI only offers it once the countdown reached zero. */
  const finishRegulation = useCallback(
    () => leaveRegulationStep(),
    [leaveRegulationStep],
  );

  /**
   * Escape hatch after a double confirmation: records the skip marker with
   * the run (it rides on the post record into reports/history), then leaves
   * through the same exit as the normal finish.
   */
  const skipRemainingRegulation = useCallback(
    () => leaveRegulationStep({ regulationSkipped: true }),
    [leaveRegulationStep],
  );

  /**
   * Discards the current run (kept records stay in the database). A live EEG
   * recording is stopped first (R4/F3): the abandoned run no longer owns it,
   * and leaving it running would grow the file indefinitely with nobody left
   * to associate or stop it.
   */
  const resetFlow = useCallback(() => {
    // Invalidate any in-flight EEG start before it can mark the fresh run.
    flowGenerationRef.current += 1;
    awaitingSessionIdRef.current = false;

    if (eegAssociationRef.current === 'recording') {
      eegAssociationRef.current = 'unavailable';
      void stopRecord();
    }

    setActionError(null);
    resultReports.clearResults();
    setState(createEffectEvaluationFlowState());
    // The effect above re-writes storage; drop the key in case writes fail.
    clearStoredFlowState();
  }, [resultReports, stopRecord]);

  const openRegulationPage = useCallback(() => {
    navigate(regulationPathForMethod(state.method));
  }, [navigate, state.method]);

  return {
    ...resultReports,
    actionError,
    beginInduction,
    beginRegulation,
    completeInduction,
    completeScaleMeasurement,
    finishRegulation,
    inductionStatus,
    isResumedRun: storedInitialState !== null,
    isInductionPoolLoading,
    isSavingScale,
    openRegulationPage,
    resetFlow,
    scaleDefinitionFor,
    skipRemainingRegulation,
    startBaselineMeasurement,
    state,
    updateDraft,
  };
}

export type EffectEvaluationFlow = ReturnType<typeof useEffectEvaluationFlow>;
