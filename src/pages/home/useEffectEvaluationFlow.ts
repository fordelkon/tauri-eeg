import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useEegSession } from '../../eeg/EegSessionContext';
import { getParadigmSessionStatus } from '../../eeg/paradigm/paradigmSessionStatus';
import {
  getMentalScaleForPath,
  type MentalScaleAnswers,
  type MentalScaleDefinition,
} from '../../mentalScale/mentalScaleGate';
import { buildMentalScaleStatus, updateMentalScaleStatus } from '../../mentalScale/mentalScaleStatus';
import { recordScaleCompletion } from '../../mentalScale/scaleCompletion';
import { writeStoredSubjectId } from '../../storage/currentSubject';
import {
  computeRegulationEffect,
  savePhaseScaleRecord,
  type RegulationEffectSummaryView,
  type ScalePhase,
} from '../../mentalScale/scaleRecordsApi';
import { describeFriendlyError } from '../../ui/friendlyError';
import {
  createEffectEvaluationFlowState,
  describeMissingMeasurements,
  parseFlowState,
  regulationPathForMethod,
  remainingRegulationSeconds,
  serializeFlowState,
  setupBlockingReason,
  type EffectEvaluationFlowState,
} from './effectEvaluationFlow';

/**
 * React wiring for the effect-evaluation wizard. All step gating, countdown
 * math, and copy decisions live in the pure `effectEvaluationFlow` module;
 * this hook only bridges it to React state, Tauri persistence, navigation,
 * and the EEG recording context.
 *
 * The whole state is mirrored into sessionStorage so jumping to the music/
 * video regulation page (which unmounts this route) and coming back resumes
 * the same run with a wall-clock countdown.
 */

const FLOW_STORAGE_KEY = 'effectEvaluation.flowState.v1';

function readStoredFlowState(): EffectEvaluationFlowState | null {
  try {
    return parseFlowState(window.sessionStorage.getItem(FLOW_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStoredFlowState(state: EffectEvaluationFlowState): void {
  try {
    window.sessionStorage.setItem(FLOW_STORAGE_KEY, serializeFlowState(state));
  } catch {
    // Best-effort only; an unavailable storage just disables run resume.
  }
}

function clearStoredFlowState(): void {
  try {
    window.sessionStorage.removeItem(FLOW_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

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
  // Set when this flow started the EEG recording and still expects its session
  // id; a ref because stopRecord resolves before the context publishes the row.
  const awaitingSessionIdRef = useRef(false);

  useEffect(() => {
    writeStoredFlowState(state);
  }, [state]);

  const isOnRegulationStep = state.step === 2;

  // Wall-clock countdown while regulating: it keeps running across the jump
  // to the music/video page, so on return only the display needs refreshing.
  useEffect(() => {
    if (!isOnRegulationStep || state.regulationStartedAtMs === null) {
      return undefined;
    }

    const intervalId = window.setInterval(() => setNowMs(Date.now()), 500);

    return () => window.clearInterval(intervalId);
  }, [isOnRegulationStep, state.regulationStartedAtMs]);

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

  const scaleForMethod: MentalScaleDefinition | null = useMemo(
    () => getMentalScaleForPath(regulationPathForMethod(state.method)),
    [state.method],
  );

  const updateDraft = useCallback((
    patch: Partial<Pick<
      EffectEvaluationFlowState,
      'subjectId' | 'emotion' | 'method' | 'durationMinutes'
    >>,
  ) => {
    setState((current) => ({ ...current, ...patch }));
  }, []);

  /** Step 1 → 2: validates the subject binding before any measurement. */
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
   * Steps 2/4: persists one scale submission under this run's subject and
   * phase, mirrors it into the in-memory status/gate caches exactly like the
   * standalone gate flow (so walking into the regulation page mid-loop does
   * not re-prompt the gate dialog), then advances.
   */
  const completeScaleMeasurement = useCallback(async (
    phase: ScalePhase,
    answers: MentalScaleAnswers,
  ) => {
    const scale = scaleForMethod;

    if (!scale || isSavingScale) {
      return;
    }

    setIsSavingScale(true);
    setActionError(null);

    try {
      const record = await savePhaseScaleRecord(scale, answers, {
        userId: currentUser?.id ?? null,
        subjectId: state.subjectId.trim(),
        phase,
      });

      updateMentalScaleStatus(buildMentalScaleStatus(scale, answers));
      recordScaleCompletion(scale.path);

      setState((current) => (
        phase === 'baseline'
          ? { ...current, baselineRecordId: record.id, step: 2 }
          : { ...current, postRecordId: record.id, step: 4 }
      ));
    } catch (error) {
      setActionError(describeFriendlyError(error, '保存量表记录'));
    } finally {
      setIsSavingScale(false);
    }
  }, [currentUser?.id, isSavingScale, scaleForMethod, state.subjectId]);

  /**
   * Step 3 entry: starts the wall-clock timer and best-effort associates an
   * EEG free recording. An unavailable device or a live paradigm session
   * degrades to `unavailable` — never blocks the loop.
   */
  const beginRegulation = useCallback(() => {
    setActionError(null);

    if (getParadigmSessionStatus().active) {
      setActionError('范式 Session 进行中，请先结束范式采集再开始调控。');
      return;
    }

    setState((current) => ({
      ...current,
      regulationStartedAtMs: Date.now(),
      eegAssociation: current.eegAssociation === 'saved' ? 'saved' : 'not-started',
    }));
    setNowMs(Date.now());

    if (!canStartRecord || !currentUser) {
      setState((current) => ({ ...current, eegAssociation: 'unavailable' }));
      return;
    }

    void startRecord()
      .then((started) => {
        awaitingSessionIdRef.current = started;
        setState((current) => (
          started
            ? { ...current, eegAssociation: 'recording' }
            : { ...current, eegAssociation: 'unavailable' }
        ));
      })
      .catch(() => {
        setState((current) => ({ ...current, eegAssociation: 'unavailable' }));
      });
  }, [canStartRecord, currentUser, startRecord]);

  /** Step 3 exit: stops the associated recording, then moves to the post scale. */
  const finishRegulation = useCallback(async () => {
    setActionError(null);

    if (state.eegAssociation !== 'recording') {
      awaitingSessionIdRef.current = false;
      setState((current) => ({ ...current, step: 3 }));
      return;
    }

    // Re-arm the capture even on a resumed run (the ref does not survive the
    // remount after jumping to the regulation page).
    awaitingSessionIdRef.current = true;
    const stopped = await stopRecord();

    if (!stopped) {
      // No session row will arrive; don't leave the watcher armed for an
      // unrelated future recording.
      awaitingSessionIdRef.current = false;
    }
    // On success the session id lands via the watcher effect above.
    setState((current) => ({
      ...current,
      step: 3,
      eegAssociation: stopped ? 'saved' : 'unavailable',
    }));
  }, [state.eegAssociation, stopRecord]);

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
    if (state.step === 4 && !summary && !summaryError && !isLoadingSummary) {
      void loadSummary();
    }
  }, [isLoadingSummary, loadSummary, state.step, summary, summaryError]);

  /** Discards the current run (kept records stay in the database). */
  const resetFlow = useCallback(() => {
    awaitingSessionIdRef.current = false;
    setActionError(null);
    setSummary(null);
    setSummaryError(null);
    setState(createEffectEvaluationFlowState());
    // The effect above re-writes storage; drop the key in case writes fail.
    clearStoredFlowState();
  }, []);

  const openRegulationPage = useCallback(() => {
    navigate(regulationPathForMethod(state.method));
  }, [navigate, state.method]);

  const remainingSeconds = remainingRegulationSeconds(state, nowMs);

  return {
    actionError,
    beginRegulation,
    completeScaleMeasurement,
    finishRegulation,
    isLoadingSummary,
    isSavingScale,
    loadSummary,
    openRegulationPage,
    remainingSeconds,
    resetFlow,
    scaleForMethod,
    startBaselineMeasurement,
    state,
    summary,
    summaryError,
    updateDraft,
  };
}

export type EffectEvaluationFlow = ReturnType<typeof useEffectEvaluationFlow>;
