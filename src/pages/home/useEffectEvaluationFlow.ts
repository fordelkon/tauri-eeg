import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useEegSession } from '../../eeg/EegSessionContext';
import { loadParadigmVideoLibrary } from '../../eeg/paradigm/paradigmApi';
import { readStoredLibraryRootPath } from '../../eeg/paradigm/paradigmStorage';
import { getParadigmSessionStatus } from '../../eeg/paradigm/paradigmSessionStatus';
import type { ParadigmVideoEntry } from '../../eeg/paradigm/types';
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
import { writeStoredSubjectId } from '../../storage/currentSubject';
import {
  computeConditionEffect,
  computeRegulationEffect,
  savePhaseInstrumentRecord,
  type ConditionEffectComparisonView,
  type RegulationEffectSummaryView,
  type ScalePhase,
} from '../../mentalScale/scaleRecordsApi';
import { describeFriendlyError } from '../../ui/friendlyError';
import {
  clearFlowStateFromStorage,
  createEffectEvaluationFlowState,
  describeInductionPoolStatus,
  describeMissingMeasurements,
  isRegulationWindowOpen,
  paradigmPoolKeyForEmotion,
  readFlowStateFromStorage,
  regulationPathForMethod,
  remainingRegulationSeconds,
  setupBlockingReason,
  writeFlowStateToStorage,
  type EffectEvaluationFlowState,
  type InductionPoolStatus,
} from './effectEvaluationFlow';

/**
 * React wiring for the effect-evaluation wizard (R6: 设置 -> 情绪诱发 ->
 * 诱发后量表 -> 条件执行 -> 条件后量表 -> 结果评价). All step gating,
 * countdown math, and copy decisions live in the pure `effectEvaluationFlow`
 * module; this hook only bridges it to React state, Tauri persistence,
 * navigation, and the EEG recording context.
 *
 * The whole state is mirrored into sessionStorage so jumping to the music/
 * video regulation page (which unmounts this route) and coming back resumes
 * the same run with a wall-clock countdown. Only the 调控 condition jumps;
 * the 自然恢复 (基线) condition runs its countdown inside this page.
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

  const [state, setState] = useState<EffectEvaluationFlowState>(
    () => readStoredFlowState() ?? createEffectEvaluationFlowState(),
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isSavingScale, setIsSavingScale] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RegulationEffectSummaryView | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  // Cross-condition comparison (R6, 大纲 6.2): regulation vs natural-recovery
  // runs of the same subject+emotion; independent of the in-run summary.
  const [conditionComparison, setConditionComparison] = useState<ConditionEffectComparisonView | null>(null);
  const [conditionComparisonError, setConditionComparisonError] = useState<string | null>(null);
  const [isLoadingConditionComparison, setIsLoadingConditionComparison] = useState(false);
  // Induction-step video pool (R6): entries of the target emotion's class in
  // the video_paradigm library; null = no valid library / unusable pool.
  const [inductionPool, setInductionPool] = useState<readonly ParadigmVideoEntry[] | null>(null);
  const [isInductionPoolLoading, setIsInductionPoolLoading] = useState(false);
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

  const isOnConditionStep = state.step === 3;

  // Wall-clock countdown while the condition window runs (both conditions):
  // it keeps running across the 调控 condition's jump to the music/video
  // page, so on return only the display needs refreshing.
  useEffect(() => {
    if (!isOnConditionStep || state.regulationStartedAtMs === null) {
      return undefined;
    }

    const intervalId = window.setInterval(() => setNowMs(Date.now()), 500);

    return () => window.clearInterval(intervalId);
  }, [isOnConditionStep, state.regulationStartedAtMs]);

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
   * joins the post leg (node ④) for the music condition only.
   */
  const postScaleDefinition = useMemo(
    () => buildBatteryDefinition({ includeGems: state.method === 'music' }),
    [state.method],
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

  // Load the induction pool when the induction step becomes visible (R6):
  // the video_paradigm library root stored by the EEG acquisition page feeds
  // the emotion's entries; a missing/invalid library degrades to null and the
  // pure status helper turns that into an explicit blocked copy.
  useEffect(() => {
    if (state.step !== 1) {
      return undefined;
    }

    const rootPath = readStoredLibraryRootPath();
    // R8: every wizard emotion maps onto a scheduled paradigm class.
    const poolKey = paradigmPoolKeyForEmotion(state.emotion);

    if (rootPath.length === 0) {
      setInductionPool(null);
      setIsInductionPoolLoading(false);
      return undefined;
    }

    let cancelled = false;
    setIsInductionPoolLoading(true);

    void loadParadigmVideoLibrary(rootPath)
      .then((library) => {
        if (cancelled) {
          return;
        }

        setInductionPool(library.valid ? (library[poolKey] ?? null) : null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setInductionPool(null);
      })
      .finally(() => {
        if (!cancelled) {
          setIsInductionPoolLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [state.emotion, state.step]);

  // The pool entry is picked once per (emotion, pool); the memo keeps the
  // pick stable across re-renders of the step.
  const inductionStatus: InductionPoolStatus = useMemo(
    () => describeInductionPoolStatus(state.emotion, inductionPool),
    [state.emotion, inductionPool],
  );

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
   * Step 3 entry: starts the wall-clock timer. The EEG side either keeps the
   * recording already running since the induction step, or starts one now
   * (device was unavailable at induction, or a legacy resumed run). A live
   * paradigm session blocks the entry as before.
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
    setNowMs(Date.now());

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
   * Cross-condition comparison (R6, 大纲 6.2): pairs this subject+emotion's
   * latest complete run of each condition and computes the regulation
   * condition's improvement relative to the natural-recovery baseline. Errors
   * when either condition has no complete run yet - the result step renders
   * that as guidance instead of a hard failure.
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
    setSummary(null);
    setSummaryError(null);
    setConditionComparison(null);
    setConditionComparisonError(null);
    setState(createEffectEvaluationFlowState());
    // The effect above re-writes storage; drop the key in case writes fail.
    clearStoredFlowState();
  }, [stopRecord]);

  const openRegulationPage = useCallback(() => {
    navigate(regulationPathForMethod(state.method));
  }, [navigate, state.method]);

  const remainingSeconds = remainingRegulationSeconds(state, nowMs);

  return {
    actionError,
    beginInduction,
    beginRegulation,
    completeInduction,
    completeScaleMeasurement,
    conditionComparison,
    conditionComparisonError,
    finishRegulation,
    inductionStatus,
    isLoadingConditionComparison,
    isLoadingSummary,
    isInductionPoolLoading,
    isSavingScale,
    loadConditionComparison,
    loadSummary,
    openRegulationPage,
    remainingSeconds,
    resetFlow,
    scaleDefinitionFor,
    skipRemainingRegulation,
    startBaselineMeasurement,
    state,
    summary,
    summaryError,
    updateDraft,
  };
}

export type EffectEvaluationFlow = ReturnType<typeof useEffectEvaluationFlow>;
