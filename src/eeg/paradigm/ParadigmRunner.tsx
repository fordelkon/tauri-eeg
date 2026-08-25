import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createPortal } from 'react-dom';
import { getEegStatus } from '../eegApi';
import { describeEegError } from '../eegErrorMessages';
import { useEegSession } from '../EegSessionContext';
import { evaluateParadigmAcceptance } from './paradigmAcceptance';
import {
  beginEegTrial,
  endEegTrial,
  finalizeEegTrial,
  getParadigmSessionSummary,
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
  defaultParadigmSessionStatus,
  setParadigmSessionStatus,
} from './paradigmSessionStatus';
import { isVideoDurationOutOfRange } from './paradigmTimeline';
import { useConfirmDialog } from '../../ui/useConfirmDialog';
import SamRatingDialog from './SamRatingDialog';
import TrialStageRenderer, {
  StageNoticeBar,
  type TrialStageNotice,
  type TrialStageNoticeAction,
  type TrialStagePhase,
} from './TrialStageRenderer';
import type { ParadigmStartRequest } from './ParadigmSetupPanel';
import {
  paradigmEmotionLabels,
  trialQualityLabels,
  PARADIGM_TRIALS_PER_CLASS,
} from './types';
import type {
  ParadigmSessionSummary,
  ParadigmTrialPlanItem,
  SelfReport,
  TrialMarkKind,
  TrialQuality,
  TrialRecord,
  TrialSnapshot,
} from './types';
import styles from './ParadigmSession.module.css';

type Props = {
  request: ParadigmStartRequest;
  onExitToSetup: () => void;
};

/**
 * Banner copy carries business semantics only — IPC command names stay in
 * code. The detail half comes from the central eegErrorMessages mapping:
 * recognized backend errors add a concrete cause, everything else degrades to
 * a generic Chinese hint (original text goes to console.error).
 */
function toCommandErrorMessage(label: string, error: unknown, fallback: string) {
  return `${label}:${describeEegError(error, fallback)}`;
}

/** Business label per trial mark kind; the raw mark ids are protocol vocabulary. */
const TRIAL_MARK_LABELS: Record<TrialMarkKind, string> = {
  pre_video_hint: '视频前提示标记发送失败',
  video: '视频播放标记发送失败',
  post_video_rest: '试后休息标记发送失败',
};

const STAGE_PHASES: readonly string[] = ['baseline', 'hint', 'video', 'postRest'];

/** Indices where a new emotion block starts (index 0 always starts one). */
function toBlockStarts(queue: ParadigmTrialPlanItem[]): number[] {
  const starts: number[] = [];
  queue.forEach((item, index) => {
    if (index === 0 || item.emotion !== queue[index - 1].emotion) {
      starts.push(index);
    }
  });
  return starts;
}

/** 1-based position of a trial inside its emotion block. */
function videoNumberFor(trialIndex: number, blockStarts: number[]): number {
  let start = 0;
  for (const candidate of blockStarts) {
    if (candidate <= trialIndex) {
      start = candidate;
    }
  }
  return trialIndex - start + 1;
}

export default function ParadigmRunner({ request, onExitToSetup }: Props) {

  const eeg = useEegSession();

  const dryRun = request.dryRun;

  // Promise-based MUI confirm replaces the native window.confirm calls that

  // blocked the runner's render loop and clashed with the app's dialog system.

  const { confirm, confirmDialogElement } = useConfirmDialog();
  const [state, dispatch] = useReducer(paradigmSessionReducer, initialParadigmSessionState);
  const [snapshot, setSnapshot] = useState<TrialSnapshot | null>(null);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number | null>(null);
  const [summary, setSummary] = useState<ParadigmSessionSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
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
  const finishHandledRef = useRef(false);
  // Dry-run finalize results, summarized locally instead of via the backend.
  const dryRunRecordsRef = useRef<TrialRecord[]>([]);

  const currentPlan = state.currentTrialIndex >= 0
    ? state.queue[state.currentTrialIndex] ?? null
    : null;
  const stagePhase = STAGE_PHASES.includes(state.trialPhase)
    ? state.trialPhase as TrialStagePhase
    : null;

  const blockStarts = useMemo(() => toBlockStarts(state.queue), [state.queue]);
  const blockCount = blockStarts.length;
  const currentBlockNumber = blockStarts.filter(
    (start) => start <= Math.max(state.currentTrialIndex, 0),
  ).length || 1;
  const nextTrialIndex = state.currentTrialIndex + 1;
  const pendingBlockStart = (
    nextTrialIndex > 0
    && nextTrialIndex < state.queue.length
    && blockStarts.includes(nextTrialIndex)
  )
    ? nextTrialIndex
    : null;
  const awaitingBlockGate = pendingBlockStart !== null && blockGate !== pendingBlockStart;
  const completedBlockCount = pendingBlockStart !== null
    ? blockStarts.filter((start) => start < pendingBlockStart).length
    : 0;
  const currentVideoNumber = state.currentTrialIndex >= 0
    ? videoNumberFor(state.currentTrialIndex, blockStarts)
    : 1;
  const upcomingVideoNumber = videoNumberFor(nextTrialIndex, blockStarts);

  // --- Global lock store -------------------------------------------------

  const isSessionActive = state.phase === 'running';

  useEffect(() => {
    setParadigmSessionStatus({
      active: isSessionActive,
      phase: state.phase,
      trialIndex: state.currentTrialIndex + 1,
      totalTrials: state.queue.length,
    });
  }, [isSessionActive, state.phase, state.currentTrialIndex, state.queue.length]);

  useEffect(() => () => {
    setParadigmSessionStatus(defaultParadigmSessionStatus);
  }, []);

  // Guard against a dirty refresh / accidental close while the session runs.
  useEffect(() => {
    if (state.phase !== 'running') {
      return undefined;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome/WebView2 requires returnValue to be set.
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state.phase]);

  // Fullscreen exactly while a video is playing: enter when the video stage
  // begins, leave when it ends — baseline/hint/SAM/stage breaks stay windowed.
  // The native window API resizes the real OS window (WebView2's element
  // fullscreen only fills the webview) and needs no user activation.
  const isVideoStage = state.phase === 'running' && state.trialPhase === 'video';

  useEffect(() => {
    if (!isVideoStage) {
      return undefined;
    }

    void getCurrentWindow().setFullscreen(true).catch((error) => {
      // Most often a stale build without the set-fullscreen capability.
      console.warn('[paradigm] 进入视频全屏失败', error);
    });

    return () => {
      void getCurrentWindow().setFullscreen(false).catch(() => {});
    };
  }, [isVideoStage]);

  // --- Session bootstrap -------------------------------------------------

  useEffect(() => {
    // The reducer only accepts session_started from the setup phase, so walk
    // the machine through its documented lifecycle (idle → setup → running).
    // On re-runs the phase no longer matches and both actions are ignored,
    // which is fine: a fresh Runner instance owns every session.
    dispatch({ type: 'enter_setup' });
    dispatch({ type: 'session_started', queue: request.queue });
  }, [request.queue]);

  useEffect(() => {
    if (dryRun) {
      return undefined;
    }

    let disposed = false;

    getEegStatus()
      .then((status) => {
        if (!disposed && status.activeRecording) {
          dispatch({ type: 'session_id_resolved', sessionId: status.activeRecording.id });
        }
      })
      .catch(() => {
        // The summary step re-resolves the id if this poll failed.
      });

    return () => {
      disposed = true;
    };
  }, [dryRun]);

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
    if (nextIndex > 0 && blockStarts.includes(nextIndex) && blockGate !== nextIndex) {
      return;
    }
    if (begunTrialIndexRef.current === nextIndex) {
      return;
    }
    begunTrialIndexRef.current = nextIndex;

    if (dryRun) {
      setSnapshot(makeDryRunSnapshot(item));
      setVideoDurationSeconds(null);
      videoMarkedRef.current = false;
      dispatch({ type: 'trial_started', trialIndex: item.trialIndex });
      return;
    }

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
  }, [state.phase, state.trialPhase, state.currentTrialIndex, state.queue, blockStarts, blockGate, beginRetryToken, dryRun]);

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
    if (state.trialPhase === 'postRest') {
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
      suggestedQuality: evaluateParadigmAcceptance(
        plan.emotion,
        selfReport.valence,
        selfReport.arousal,
      ),
    });
  }, [state.queue, state.currentTrialIndex]);

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
  ]);

  // --- Session finish ----------------------------------------------------

  useEffect(() => {
    if (state.phase !== 'finished' || finishHandledRef.current) {
      return;
    }
    finishHandledRef.current = true;

    if (dryRun) {
      setSummary(summarizeDryRunTrials(dryRunRecordsRef.current));
      return;
    }

    void (async () => {
      try {
        let sessionId = state.sessionId;
        if (!sessionId) {
          const status = await getEegStatus();
          sessionId = status.activeRecording?.id ?? null;
        }

        // Resolve the id before stopping: activeRecording is cleared once the
        // continuous recording stops.
        await eeg.stopRecord();

        if (!sessionId) {
          setSummaryError('无法确定 Session ID,未能加载训练前统计。');
          return;
        }

        setSummary(await getParadigmSessionSummary(sessionId));
      } catch (error) {
        setSummaryError(toCommandErrorMessage(
          '训练前统计加载失败',
          error,
          'Summary could not be loaded.',
        ));
      }
    })();
  }, [state.phase, state.sessionId, eeg, dryRun]);

  const handleEarlyEnd = useCallback(async () => {

    if (dryRun) {

      if (!(await confirm({ title: '确定提前结束试运行吗?', description: '未写入任何数据。' }))) {

        return;

      }

      dispatch({ type: 'end_session' });

      onExitToSetup();

      return;

    }



    if (!(await confirm({ title: '确定提前结束 Session 吗?', description: '当前活动试次将被后端记录为 interrupted。' }))) {

      return;

    }



    // The backend marks the still-active trial as interrupted on stop.

    void eeg.stopRecord();

    dispatch({ type: 'end_session' });

    onExitToSetup();

  }, [confirm, dryRun, eeg, onExitToSetup]);

  const handleReturnToSetup = useCallback(() => {
    dispatch({ type: 'end_session' });
    onExitToSetup();
  }, [onExitToSetup]);

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

  // --- Render ------------------------------------------------------------

  if (state.phase === 'finished') {
    return (
      <div className={styles.panel} aria-label="范式 Session 训练前统计">
        <header className={styles.dialogHeader}>
          <p className={styles.dialogEyebrow}>Session 完成</p>
          <h2 className={styles.dialogTitle}>训练前统计</h2>
          <p className={styles.dialogDescription}>
            {dryRun
              ? '试运行结束,未写入任何数据。'
              : `连续记录已自动停止。Session ID:${summary?.sessionId ?? state.sessionId ?? '未知'}`}
          </p>
        </header>

        {summaryError ? <div className={styles.errorBanner}>{summaryError}</div> : null}

        {summary ? (
          <>
            <table className={styles.summaryTable}>
              <thead>
                <tr>
                  <th>情绪</th>
                  <th>{trialQualityLabels.accepted}</th>
                  <th>{trialQualityLabels.uncertain}</th>
                  <th>{trialQualityLabels.rejected}</th>
                  <th>{trialQualityLabels.artifact_rejected}</th>
                  <th>中断</th>
                </tr>
              </thead>
              <tbody>
                {summary.perClass
                  .filter((row) => (
                    row.accepted
                    + row.uncertain
                    + row.rejected
                    + row.artifactRejected
                    + row.interrupted
                    > 0
                  ))
                  .map((row) => (
                    <tr key={row.emotion}>
                      <td>{paradigmEmotionLabels[row.emotion]}</td>
                      <td>{row.accepted}</td>
                      <td>{row.uncertain}</td>
                      <td>{row.rejected}</td>
                      <td>{row.artifactRejected}</td>
                      <td>{row.interrupted}</td>
                    </tr>
                  ))}
              </tbody>
            </table>

            <div className={styles.summaryMeans}>
              <span>共 {summary.totalTrials} 个试次</span>
              <span>愉悦度均值 {summary.valenceMean === null ? '—' : summary.valenceMean.toFixed(2)}</span>
              <span>唤醒度均值 {summary.arousalMean === null ? '—' : summary.arousalMean.toFixed(2)}</span>
            </div>

            {summary.warnings.length > 0 ? (
              <ul className={styles.summaryWarnings}>
                {summary.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className={styles.sectionHint}>正在加载训练前统计…</p>
        )}

        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleReturnToSetup}
          >
            返回设置
          </button>
        </div>
      </div>
    );
  }

  const canRetryBegin = (
    state.phase === 'running'
    && state.trialPhase === 'interTrial'
    && state.errorMessage !== null
    && !isStartingTrial
  );
  const canRetryEndTrial = (
    state.phase === 'running'
    && state.trialPhase === 'postRest'
    && state.errorMessage !== null
    && !isEndingTrial
  );
  const canRetryFinalize = (
    state.phase === 'running'
    && state.trialPhase === 'qualityCheck'
    && state.errorMessage !== null
    && !isFinalizing
  );

  // The fullscreen stage portals mount at document.body above the whole
  // .content stacking context, so the panel banner (and its retry buttons)
  // is unreachable whenever a stage covers the screen. The same failures are
  // therefore mirrored into every stage as a notice with clickable retries.
  const stageNoticeActions: TrialStageNoticeAction[] = [];
  if (canRetryBegin) {
    stageNoticeActions.push({ label: '重试开始试次', onClick: handleRetryBegin });
  }
  if (canRetryEndTrial) {
    stageNoticeActions.push({ label: '重试结束试次', onClick: handleRetryEndTrial });
  }
  if (canRetryFinalize) {
    stageNoticeActions.push({ label: '重试保存试次', onClick: handleRetryFinalize });
  }
  const stageNotice: TrialStageNotice | null = state.errorMessage
    ? { message: state.errorMessage, actions: stageNoticeActions }
    : null;

  return (
    <div className={styles.panel} aria-label="范式 Session 运行区">
      <header className={styles.runnerHeader}>
        <div className={styles.runnerProgress}>
          {dryRun ? <span>试运行</span> : null}
          <span>阶段 {currentBlockNumber} / {blockCount}</span>
          <span>试次 {state.currentTrialIndex + 1} / {state.queue.length}</span>
          <span>被试 {request.subjectId}</span>
          <span>运行 {request.sessionRunId}</span>
        </div>
        <button
          type="button"
          className={styles.dangerButton}
          onClick={handleEarlyEnd}
        >
          提前结束 Session
        </button>
      </header>

      {state.errorMessage ? (
        <div className={styles.errorBanner}>
          <span>{state.errorMessage}</span>
          {canRetryBegin ? (
            <button type="button" className={styles.secondaryButton} onClick={handleRetryBegin}>
              重试开始试次
            </button>
          ) : null}
          {canRetryEndTrial ? (
            <button type="button" className={styles.secondaryButton} onClick={handleRetryEndTrial}>
              重试结束试次
            </button>
          ) : null}
          {canRetryFinalize ? (
            <button type="button" className={styles.secondaryButton} onClick={handleRetryFinalize}>
              重试保存试次
            </button>
          ) : null}
        </div>
      ) : null}

      {state.phase === 'error' ? (
        <div className={styles.actionRow}>
          <button type="button" className={styles.primaryButton} onClick={handleReturnToSetup}>
            返回设置
          </button>
        </div>
      ) : null}

      {stagePhase && currentPlan ? (
        <>
          <TrialStageRenderer
            phase={stagePhase}
            plan={currentPlan}
            trialLabel={`视频 ${currentVideoNumber} / ${PARADIGM_TRIALS_PER_CLASS}`}
            videoNumber={currentVideoNumber}
            onRequestEarlyEnd={handleEarlyEnd}
            onCountdownComplete={handleCountdownComplete}
            onVideoFirstPlay={handleVideoFirstPlay}
            onVideoEnded={handleVideoEnded}
            onVideoDurationLoaded={handleVideoDurationLoaded}
            onSkipTrial={handleSkipTrial}
            stageNotice={stageNotice}
          />
          {isEndingTrial ? (
            <p className={styles.sectionHint}>正在结束试次采集(end_eeg_trial),请稍候…</p>
          ) : null}
        </>
      ) : null}

      {state.trialPhase === 'interTrial' && state.phase === 'running' ? (
        createPortal(
          <div className={styles.stageHost}>
            <span className={styles.stageTrialLabel}>
              视频 {upcomingVideoNumber} / {PARADIGM_TRIALS_PER_CLASS}
            </span>
            <button type="button" className={styles.stageEndButton} onClick={handleEarlyEnd}>
              结束
            </button>
            {stageNotice ? <StageNoticeBar notice={stageNotice} /> : null}
            <div className={styles.stageMessage}>
              {awaitingBlockGate && pendingBlockStart !== null ? (
                <>
                  <span className={styles.stageTitle}>阶段间休息</span>
                  <span className={styles.stageHintText}>
                    第 {completedBlockCount} / {blockCount} 阶段完成,被试休息片刻后继续
                  </span>
                  <button
                    type="button"
                    className={styles.stageActionButton}
                    onClick={() => setBlockGate(pendingBlockStart)}
                  >
                    开始下一阶段
                  </button>
                </>
              ) : (
                <span className={styles.stageTitle}>
                  {isStartingTrial
                    ? '正在开始试次…'
                    : stageNotice
                      ? '试次启动失败'
                      : '准备下一个试次'}
                </span>
              )}
            </div>
          </div>,
          // Same portal reason as TrialStageRenderer: the app shell's lingering
          // transforms would otherwise embed this fixed stage in the layout.
          document.body,
        )
      ) : null}

      {state.trialPhase === 'selfReport' ? (
        <SamRatingDialog
          videoNumber={currentVideoNumber}
          videosInBlock={PARADIGM_TRIALS_PER_CLASS}
          onSubmit={handleSelfReportSubmit}
        />
      ) : null}

      {state.trialPhase === 'qualityCheck' ? (
        <div className={styles.stageHost} aria-label="试次保存中">
          <span className={styles.stageTrialLabel}>
            视频 {currentVideoNumber} / {PARADIGM_TRIALS_PER_CLASS}
          </span>
          <button type="button" className={styles.stageEndButton} onClick={handleEarlyEnd}>
            结束
          </button>
          {stageNotice ? <StageNoticeBar notice={stageNotice} /> : null}
          <div className={styles.stageMessage}>
            <span className={styles.stageTitle}>
              {isFinalizing
                ? '正在保存试次…'
                : stageNotice
                  ? '试次保存失败'
                  : '正在准备下一个视频…'}
            </span>
          </div>
        </div>
      ) : null}
      {confirmDialogElement}
    </div>
  );
}
