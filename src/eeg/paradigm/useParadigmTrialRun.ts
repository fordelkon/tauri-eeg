import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { evaluateParadigmAcceptance } from './paradigmAcceptance';
import {
  beginEegTrial,
  endEegTrial,
  finalizeEegTrial,
  markEegTrial,
} from './paradigmApi';
import {
  initialParadigmSessionState,
  paradigmSessionReducer,
} from './paradigmSessionState';
import {
  appendDryRunMark,
  endDryRunSnapshot,
  makeDryRunSnapshot,
  makeDryRunTrialRecord,
  summarizeDryRunTrials,
} from './paradigmDryRun';
import {
  isVideoDurationOutOfRange,
} from './paradigmTimeline';
import {
  simulateRegulationFeedback,
  summarizeRegulationFeedback,
} from './regulationFeedbackSim';
import type {
  RegulationFeedbackSample,
  RegulationFeedbackStat,
} from './regulationFeedbackSim';
import { describeParadigmQueueProgress } from './paradigmBlockQueue';
import { toCommandErrorMessage, TRIAL_MARK_LABELS } from './paradigmCommandErrors';
import { useParadigmSessionId } from './useParadigmSessionId';
import { useParadigmSessionSummary } from './useParadigmSessionSummary';
import type { ParadigmStartRequest } from './ParadigmSetupPanel';
import type {
  SelfReport,
  TrialMarkKind,
  TrialQuality,
  TrialRecord,
  TrialSnapshot,
} from './types';

/**
 * Trial-lifecycle state machine wiring for the paradigm runner (React hook
 * half of ParadigmRunner): the reducer session state, the begin/mark/end/
 * finalize command chain with its single-fire guards and retries, and the
 * dry-run simulation bookkeeping. Session-id resolution, the finished-session
 * summary load, and the command-failure copy live in their own modules.
 */

type UseParadigmTrialRunOptions = {
  request: ParadigmStartRequest;
  /** Dev mode: skip device checks and run the whole flow without writing data. */
  dryRun: boolean;
  /** Regulation sessions run the closed-loop trial flow (dry-run only for now). */
  isRegulationSession: boolean;
  /** Promise-based confirm (the runner's shared MUI dialog). */
  confirm: (options: { title: string; description: string }) => Promise<boolean>;
  /** Context stop command used by the finish chain and the orphan guard. */
  stopRecord: () => Promise<boolean>;
};

export function useParadigmTrialRun({
  request,
  dryRun,
  isRegulationSession,
  confirm,
  stopRecord,
}: UseParadigmTrialRunOptions) {
  const [state, dispatch] = useReducer(paradigmSessionReducer, initialParadigmSessionState);
  const [snapshot, setSnapshot] = useState<TrialSnapshot | null>(null);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number | null>(null);
  const [isStartingTrial, setIsStartingTrial] = useState(false);
  const [isEndingTrial, setIsEndingTrial] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [beginRetryToken, setBeginRetryToken] = useState(0);
  const [finalizeRetryToken, setFinalizeRetryToken] = useState(0);
  // Block boundary (gate) the operator has explicitly dismissed; the runner
  // auto-advances within a block but waits for a click between blocks.
  const [blockGate, setBlockGate] = useState(-1);
  const begunTrialIndexRef = useRef<number | null>(null);
  const finalizedTrialIndexRef = useRef<number | null>(null);
  const phaseMarkRef = useRef('');
  const videoMarkedRef = useRef(false);
  // Dry-run finalize results, summarized locally instead of via the backend.
  const dryRunRecordsRef = useRef<TrialRecord[]>([]);
  // Simulated decoder output for the active regulation trial (null otherwise).
  const [activeFeedback, setActiveFeedback] = useState<RegulationFeedbackSample | null>(null);
  const activeFeedbackRef = useRef<RegulationFeedbackSample | null>(null);
  // Dry-run regulation statistics, aggregated into the finished-screen summary.
  const dryRunRegulationRef = useRef<RegulationFeedbackStat[]>([]);

  const progress = useMemo(
    () => describeParadigmQueueProgress(state.queue, state.currentTrialIndex, blockGate),
    [state.queue, state.currentTrialIndex, blockGate],
  );

  // --- Session bootstrap -------------------------------------------------

  useEffect(() => {
    // The reducer only accepts session_started from the setup phase, so walk
    // the machine through its documented lifecycle (idle → setup → running).
    // On re-runs the phase no longer matches and both actions are ignored,
    // which is fine: a fresh Runner instance owns every session.
    dispatch({ type: 'enter_setup' });
    dispatch({
      type: 'session_started',
      queue: request.queue,
      sessionKind: request.sessionKind,
    });
  }, [request.queue, request.sessionKind]);

  useParadigmSessionId(dryRun, dispatch);

  const { summary, summaryError } = useParadigmSessionSummary({
    phase: state.phase,
    sessionId: state.sessionId,
    dryRun,
    summarizeDryRun: () => summarizeDryRunTrials(dryRunRecordsRef.current),
    stopRecord,
  });

  // --- Trial lifecycle ---------------------------------------------------

  // Auto-begin the next trial while in interTrial. Block boundaries are the
  // exception: they hold on the rest screen until the operator clicks. The ref
  // guard keeps the IPC call single even if the effect re-runs (dev
  // StrictMode, retries).
  useEffect(() => {
    if (state.phase !== 'running' || state.trialPhase !== 'interTrial') {
      return;
    }

    const nextIndex = state.currentTrialIndex + 1;
    const item = state.queue[nextIndex];
    if (!item || item.trialIndex !== nextIndex) {
      return;
    }
    if (nextIndex > 0 && progress.blockStarts.includes(nextIndex) && blockGate !== nextIndex) {
      return;
    }
    if (begunTrialIndexRef.current === nextIndex) {
      return;
    }
    begunTrialIndexRef.current = nextIndex;

    if (dryRun) {
      // Regulation trials draw one simulated decoder output per trial; the
      // feedback stage reads it and the finalize path records the statistics.
      const simulatedFeedback = dryRun && isRegulationSession
        ? simulateRegulationFeedback(item.emotion)
        : null;
      activeFeedbackRef.current = simulatedFeedback;
      setActiveFeedback(simulatedFeedback);
      setSnapshot(makeDryRunSnapshot(item));
      setVideoDurationSeconds(null);
      videoMarkedRef.current = false;
      dispatch({ type: 'trial_started', trialIndex: item.trialIndex });
      return;
    }

    activeFeedbackRef.current = null;
    setActiveFeedback(null);
    setIsStartingTrial(true);
    beginEegTrial({
      trialIndex: item.trialIndex,
      emotion: item.emotion,
      videoId: item.videoId,
      videoPath: item.videoPath,
    })
      .then((next) => {
        setSnapshot(next);
        setVideoDurationSeconds(null);
        videoMarkedRef.current = false;
        dispatch({ type: 'trial_started', trialIndex: item.trialIndex });
      })
      .catch((error) => {
        // Allow an explicit retry from the error banner.
        begunTrialIndexRef.current = null;
        dispatch({
          type: 'command_failed',
          message: toCommandErrorMessage('开始试次失败', error, 'Trial could not be started.'),
        });
      })
      .finally(() => {
        setIsStartingTrial(false);
      });
  }, [state.phase, state.trialPhase, state.currentTrialIndex, state.queue, progress.blockStarts, blockGate, beginRetryToken, dryRun, isRegulationSession]);

  const runTrialMark = useCallback(async (mark: TrialMarkKind) => {
    if (dryRun) {
      setSnapshot((current) => (current ? appendDryRunMark(current, mark) : current));
      return;
    }

    try {
      const next = await markEegTrial(mark);
      setSnapshot(next);
    } catch (error) {
      // Marks are best effort: surface the failure without blocking the run.
      dispatch({
        type: 'command_failed',
        message: toCommandErrorMessage(TRIAL_MARK_LABELS[mark], error, 'Trial mark failed.'),
      });
    }
  }, [dryRun]);

  // pre_video_hint when the hint stage begins, post_video_rest when the
  // post-rest stage begins. Keyed per trial+phase so it fires exactly once.
  useEffect(() => {
    if (state.phase !== 'running') {
      return;
    }
    if (state.trialPhase !== 'hint' && state.trialPhase !== 'postRest') {
      return;
    }

    const key = `${state.currentTrialIndex}:${state.trialPhase}`;
    if (phaseMarkRef.current === key) {
      return;
    }
    phaseMarkRef.current = key;

    void runTrialMark(
      state.trialPhase === 'hint' ? 'pre_video_hint' : 'post_video_rest',
    );
  }, [state.phase, state.trialPhase, state.currentTrialIndex, runTrialMark]);

  const handleVideoFirstPlay = useCallback(() => {
    if (videoMarkedRef.current) {
      return;
    }
    videoMarkedRef.current = true;
    void runTrialMark('video');
  }, [runTrialMark]);

  const runEndTrial = useCallback(async () => {
    if (isEndingTrial) {
      return;
    }

    if (dryRun) {
      setSnapshot((current) => (current ? endDryRunSnapshot(current) : current));
      dispatch({ type: 'trial_ended' });
      return;
    }

    setIsEndingTrial(true);
    try {
      const finalSnapshot = await endEegTrial();
      setSnapshot(finalSnapshot);
      dispatch({ type: 'trial_ended' });
    } catch (error) {
      dispatch({
        type: 'command_failed',
        message: toCommandErrorMessage('结束试次失败', error, 'Trial could not be ended.'),
      });
    } finally {
      setIsEndingTrial(false);
    }
  }, [dryRun, isEndingTrial]);

  const handleCountdownComplete = useCallback(() => {
    if (state.trialPhase === 'postRest' || state.trialPhase === 'feedback') {
      void runEndTrial();
      return;
    }

    dispatch({ type: 'advance_trial_phase' });
  }, [state.trialPhase, runEndTrial]);

  const handleVideoEnded = useCallback(() => {
    dispatch({ type: 'advance_trial_phase' });
  }, []);

  // Escape hatch for a video that failed to load (missing file / decode
  // error): retire only this trial and keep the session running. The backend
  // reserves 'interrupted' for End Session, so the least destructive path the
  // commands support is end_eeg_trial (freezes whatever EEG range was captured)
  // followed by a quality-only finalize with no self-report — the subject never
  // saw the video, so there is nothing to rate.
  const handleSkipTrial = useCallback(async () => {
    if (isEndingTrial || isFinalizing) {
      return;
    }

    if (!(await confirm({ title: '确定跳过该试次吗?', description: '将停止当前试次采集并标记为 rejected,然后继续下一个试次。' }))) {
      return;
    }

    // Dry-run writes nothing anywhere, so the local summary simply shows fewer
    // trials than were queued.
    if (dryRun) {
      dispatch({ type: 'trial_skipped' });
      return;
    }

    setIsEndingTrial(true);
    try {
      await endEegTrial();
      await finalizeEegTrial({
        quality: 'rejected',
        artifactFlags: [],
        operatorNotes: '视频加载失败,操作员跳过该试次。',
      });
      dispatch({ type: 'trial_skipped' });
    } catch (error) {
      dispatch({
        type: 'command_failed',
        message: toCommandErrorMessage('跳过试次失败', error, 'Trial could not be skipped.'),
      });
    } finally {
      setIsEndingTrial(false);
    }
  }, [confirm, dryRun, isEndingTrial, isFinalizing]);

  const handleVideoDurationLoaded = useCallback((seconds: number | null) => {
    setVideoDurationSeconds(seconds);
  }, []);

  const handleSelfReportSubmit = useCallback((selfReport: SelfReport) => {
    const plan = state.queue[state.currentTrialIndex];
    if (!plan) {
      return;
    }

    dispatch({
      type: 'self_report_submitted',
      selfReport,
      // Regulation SAM scores reflect the outcome of the reappraisal attempt,
      // not whether the video induced its class, so the induction acceptance
      // rule does not apply there (finalize falls back to 'accepted').
      suggestedQuality: isRegulationSession
        ? null
        : evaluateParadigmAcceptance(
          plan.emotion,
          selfReport.valence,
          selfReport.arousal,
        ),
    });
  }, [state.queue, state.currentTrialIndex, isRegulationSession]);

  const preselectedArtifactFlags = useMemo(() => {
    const flags: string[] = [];

    // Dry-run has no hardware by definition; only the real video check applies.
    if (!dryRun && snapshot && snapshot.hardwareTriggers.length === 0) {
      flags.push('trigger_missing');
    }
    if (videoDurationSeconds !== null && isVideoDurationOutOfRange(videoDurationSeconds)) {
      flags.push('video_duration_out_of_range');
    }

    return flags;
  }, [dryRun, snapshot, videoDurationSeconds]);

  // Continuous playback: no operator quality gate between trials. The trial
  // finalizes itself as soon as the SAM self-report lands, applying the same
  // rule the retired quality form defaulted to — any machine-detected artifact
  // flag locks the trial to artifact_rejected, otherwise the SAM-based
  // suggestion stands.
  useEffect(() => {
    if (state.phase !== 'running' || state.trialPhase !== 'qualityCheck') {
      return;
    }
    if (state.selfReport === null || isFinalizing) {
      return;
    }
    if (finalizedTrialIndexRef.current === state.currentTrialIndex) {
      return;
    }
    finalizedTrialIndexRef.current = state.currentTrialIndex;

    const quality: TrialQuality = preselectedArtifactFlags.length > 0
      ? 'artifact_rejected'
      : state.suggestedQuality ?? 'accepted';

    if (dryRun) {
      if (snapshot) {
        dryRunRecordsRef.current = [
          ...dryRunRecordsRef.current,
          makeDryRunTrialRecord(
            snapshot,
            state.selfReport,
            quality,
            preselectedArtifactFlags,
            null,
          ),
        ];
        if (isRegulationSession && activeFeedbackRef.current) {
          dryRunRegulationRef.current = [
            ...dryRunRegulationRef.current,
            {
              emotion: snapshot.emotion,
              baselineScore: activeFeedbackRef.current.baselineScore,
              regulationScore: activeFeedbackRef.current.regulationScore,
              deltaScore: activeFeedbackRef.current.deltaScore,
            },
          ];
        }
      }
      dispatch({ type: 'trial_finalized' });
      return;
    }

    setIsFinalizing(true);
    finalizeEegTrial({
      selfReport: state.selfReport,
      quality,
      artifactFlags: preselectedArtifactFlags,
      // labelSource intentionally omitted so the backend applies its default.
    })
      .then(() => {
        dispatch({ type: 'trial_finalized' });
      })
      .catch((error) => {
        // Keep the single-fire guard set so a failing backend cannot loop;
        // the error banner offers an explicit retry that clears it.
        dispatch({
          type: 'command_failed',
          message: toCommandErrorMessage('保存试次失败', error, 'Trial could not be finalized.'),
        });
      })
      .finally(() => {
        setIsFinalizing(false);
      });
  }, [
    state.phase,
    state.trialPhase,
    state.selfReport,
    state.suggestedQuality,
    state.currentTrialIndex,
    isFinalizing,
    finalizeRetryToken,
    dryRun,
    snapshot,
    preselectedArtifactFlags,
    isRegulationSession,
  ]);

  // --- Command retries ----------------------------------------------------
  // Rendered both in the panel-level banner and inside the fullscreen stage
  // portals, where the banner itself is unreachable (see StageNoticeBar).

  const handleRetryBegin = useCallback(() => {
    dispatch({ type: 'reset_error' });
    setBeginRetryToken((token) => token + 1);
  }, []);

  const handleRetryEndTrial = useCallback(() => {
    dispatch({ type: 'reset_error' });
    void runEndTrial();
  }, [runEndTrial]);

  const handleRetryFinalize = useCallback(() => {
    finalizedTrialIndexRef.current = null;
    dispatch({ type: 'reset_error' });
    setFinalizeRetryToken((token) => token + 1);
  }, []);

  // Dry-run regulation summary: simulated decoder statistics (baseline vs
  // regulation proximity, learning index) collected across the session.
  const regulationSummary = dryRun && isRegulationSession
    ? summarizeRegulationFeedback(dryRunRegulationRef.current)
    : null;

  return {
    activeFeedback,
    blockGate,
    dispatch,
    handleCountdownComplete,
    handleRetryBegin,
    handleRetryEndTrial,
    handleRetryFinalize,
    handleSelfReportSubmit,
    handleSkipTrial,
    handleVideoDurationLoaded,
    handleVideoEnded,
    handleVideoFirstPlay,
    isEndingTrial,
    isFinalizing,
    isStartingTrial,
    progress,
    regulationSummary,
    setBlockGate,
    state,
    summary,
    summaryError,
  };
}
