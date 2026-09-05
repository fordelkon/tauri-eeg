import { useCallback, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createPortal } from 'react-dom';
import { useEegSession } from '../EegSessionContext';
import {
  defaultParadigmSessionStatus,
  setParadigmSessionStatus,
} from './paradigmSessionStatus';
import { useConfirmDialog } from '../../ui/useConfirmDialog';
import SamRatingDialog from './SamRatingDialog';
import TrialStageRenderer, {
  StageNoticeBar,
  type TrialStageNotice,
  type TrialStageNoticeAction,
  type TrialStagePhase,
} from './TrialStageRenderer';
import type { ParadigmStartRequest } from './ParadigmSetupPanel';
import { PARADIGM_TRIALS_PER_CLASS } from './types';
import ParadigmFinishedScreen from './ParadigmFinishedScreen';
import { useParadigmTrialRun } from './useParadigmTrialRun';
import styles from './ParadigmSession.module.css';

type Props = {
  request: ParadigmStartRequest;
  onExitToSetup: () => void;
};

const STAGE_PHASES: readonly string[] = [
  'baseline',
  'hint',
  'video',
  'regulationCue',
  'regulationWindow',
  'feedback',
  'postRest',
];

/**
 * Presentation + OS lifecycle half of the paradigm runner. The trial command
 * chain (begin/mark/end/finalize, retries, summary load) lives in the
 * `useParadigmTrialRun` hook and the block-gate math in the pure
 * `paradigmBlockQueue` module; this component renders the panel banner, the
 * fullscreen stage portals, and the finished screen, and owns the early-exit
 * confirmations.
 */
export default function ParadigmRunner({ request, onExitToSetup }: Props) {
  const eeg = useEegSession();

  const dryRun = request.dryRun;
  /** Regulation sessions run the closed-loop trial flow (dry-run only for now). */
  const isRegulationSession = request.sessionKind === 'regulation_feedback';

  // Promise-based MUI confirm replaces the native window.confirm calls that
  // blocked the runner's render loop and clashed with the app's dialog system.
  const { confirm, confirmDialogElement } = useConfirmDialog();
  const {
    activeFeedback,
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
  } = useParadigmTrialRun({
    request,
    dryRun,
    isRegulationSession,
    confirm,
    stopRecord: eeg.stopRecord,
  });

  const currentPlan = state.currentTrialIndex >= 0
    ? state.queue[state.currentTrialIndex] ?? null
    : null;
  const stagePhase = STAGE_PHASES.includes(state.trialPhase)
    ? state.trialPhase as TrialStagePhase
    : null;
  // Local const so the null narrowing below survives into the click handler.
  const pendingBlockStart = progress.pendingBlockStart;

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
  // Regulation sessions additionally fullscreen the reappraisal window and the
  // feedback bar so the subject sees nothing but the stage after the video.
  // The native window API resizes the real OS window (WebView2's element
  // fullscreen only fills the webview) and needs no user activation.
  const isVideoStage = state.phase === 'running' && (
    state.trialPhase === 'video'
    || (isRegulationSession
      && (state.trialPhase === 'regulationCue'
        || state.trialPhase === 'regulationWindow'
        || state.trialPhase === 'feedback'))
  );

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

  // --- Session exits -----------------------------------------------------

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
  }, [confirm, dispatch, dryRun, eeg, onExitToSetup]);

  const handleReturnToSetup = useCallback(() => {
    dispatch({ type: 'end_session' });
    onExitToSetup();
  }, [dispatch, onExitToSetup]);

  // --- Render ------------------------------------------------------------

  if (state.phase === 'finished') {
    return (
      <ParadigmFinishedScreen
        dryRun={dryRun}
        summary={summary}
        summaryError={summaryError}
        regulationSummary={regulationSummary}
        sessionId={state.sessionId}
        onReturnToSetup={handleReturnToSetup}
      />
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
    && (state.trialPhase === 'postRest' || state.trialPhase === 'feedback')
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
          <span>阶段 {progress.currentBlockNumber} / {progress.blockCount}</span>
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
            trialLabel={`视频 ${progress.currentVideoNumber} / ${PARADIGM_TRIALS_PER_CLASS}`}
            videoNumber={progress.currentVideoNumber}
            feedback={state.trialPhase === 'feedback' ? activeFeedback : null}
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
              视频 {progress.upcomingVideoNumber} / {PARADIGM_TRIALS_PER_CLASS}
            </span>
            <button type="button" className={styles.stageEndButton} onClick={handleEarlyEnd}>
              结束
            </button>
            {stageNotice ? <StageNoticeBar notice={stageNotice} /> : null}
            <div className={styles.stageMessage}>
              {pendingBlockStart !== null && progress.awaitingBlockGate ? (
                <>
                  <span className={styles.stageTitle}>阶段间休息</span>
                  <span className={styles.stageHintText}>
                    第 {progress.completedBlockCount} / {progress.blockCount} 阶段完成,被试休息片刻后继续
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
          videoNumber={progress.currentVideoNumber}
          videosInBlock={PARADIGM_TRIALS_PER_CLASS}
          onSubmit={handleSelfReportSubmit}
        />
      ) : null}

      {state.trialPhase === 'qualityCheck' ? (
        <div className={styles.stageHost} aria-label="试次保存中">
          <span className={styles.stageTrialLabel}>
            视频 {progress.currentVideoNumber} / {PARADIGM_TRIALS_PER_CLASS}
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
