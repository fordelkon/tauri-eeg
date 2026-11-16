import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useNavigate } from 'react-router-dom';
import { ResultBdfAttachment } from '../../experiment/BdfAttachment';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { getParadigmSessionStatus } from '../../paradigm/paradigmSessionStatus';
import { useConfirmDialog } from '../../ui/useConfirmDialog';
import {
  describeRegulationSkipped,
  EFFECT_FLOW_STEP_COUNT,
  EFFECT_METHOD_OPTIONS,
  formatCountdown,
  remainingRegulationSeconds,
  type EffectFlowStep,
} from './effectEvaluationFlow';
import { describeEventLogStatus } from './effectPipeline';
import {
  ConditionStepPanel,
  EventLogUnavailableHint,
  InductionStepPanel,
  ScaleStepPanel,
  SetupStepPanel,
} from './EffectStepPanels';
import EffectHistoryPanel from './EffectHistoryPanel';
import { EffectReviewPopover } from './EffectReviewPopover';
import type { EffectReviewTarget, EffectStationClick } from './EffectTimeline';
import { EffectProgressDisclosure } from './EffectProgressDisclosure';
import { useEffectEvaluationFlow } from './useEffectEvaluationFlow';
import { useEffectPipelineNodes } from './useEffectPipelineNodes';
import { useEffectReportExports } from './useEffectReportExports';
import { useInductionPlayback } from './useInductionPlayback';
import { EmotionChangeTable } from './EmotionChangeTable';
import styles from './EffectEvaluation.module.css';
import { usePublishWorkspaceCommands } from '../../agent/workspaceCommands';
import { getEvaluationCommands } from './evaluationCommands';

type PageTab = 'wizard' | 'history';

export default function EffectEvaluation() {
  const navigate = useNavigate();
  const flow = useEffectEvaluationFlow();
  const { state } = flow;
  const { confirm, confirmDialogElement } = useConfirmDialog();
  const [dismissedMeasurement, setDismissedMeasurement] = useState<string | null>(null);
  const beforeInduction = state.step === 1 && !state.preInductionRecordId;
  const measurementKey =
    state.runId && !flow.isStartingRun && (beforeInduction || state.step === 2 || state.step === 4)
      ? `${state.runId}:${state.step}`
      : null;
  const isScaleDialogOpen =
    measurementKey !== null && !state.interrupted && dismissedMeasurement !== measurementKey;
  const {
    inductionRetryCount,
    inductionVideoFailed,
    isInductionPlaying,
    retryInductionVideo,
    setInductionVideoFailed,
    startInductionPlayback,
  } = useInductionPlayback(state.step);
  const [activeTab, setActiveTab] = useState<PageTab>('wizard');
  const {
    exportNotice,
    handleExportSingleCsv,
    handleExportSingleJson,
    isExporting,
    runBatchExport,
    setExportNotice,
  } = useEffectReportExports({
    subjectId: state.subjectId,
    baselineRecordId: state.baselineRecordId,
    postRecordId: state.postRecordId,
  });
  const [review, setReview] = useState<EffectReviewTarget | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const [isResumeNoticeDismissed, setIsResumeNoticeDismissed] = useState(false);
  const { isWindowElapsed } = flow;
  const handleWindowElapsed = flow.conditionElapsed;
  const methodLabel =
    EFFECT_METHOD_OPTIONS.find((option) => option.value === state.method)?.label ?? state.method;
  const isNaturalRecovery = state.condition === 'natural_recovery';
  const hasRenderedStepRef = useRef(false);
  useEffect(() => {
    if (!hasRenderedStepRef.current) {
      hasRenderedStepRef.current = true;
      return;
    }

    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    stage.focus({ preventScroll: true });
    stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [state.step]);
  const participantStage = state.step > 0 && state.step < 5;
  const isResultStep = state.step === 5;
  const handleResetFlow = async () => {
    const confirmed = await confirm({
      title: isResultStep ? '开始下一次评价' : '重置评价流程',
      description: isResultStep
        ? '将清空向导的当前进度并开始一次全新的评价；已保存的量表与实验事件不受影响，历史记录照常可查。'
        : '重置将中止本次实验运行并丢弃当前进度；已保存的量表记录仍会保留在历史记录中。确定要重置吗？',
      confirmText: isResultStep ? '清空并开始下一次' : '停止并重置',
      destructive: true,
    });

    if (confirmed) {
      setReview(null);
      setIsResumeNoticeDismissed(true);
      if (await flow.resetFlow()) navigate('/experiment-settings');
    }
  };
  const finishMode = flow.regulationFinishMode();
  const skippedCopy = describeRegulationSkipped(state);
  const windowNoun = isNaturalRecovery ? '静息' : '调控';
  const isWindowRunning = state.step === 3 && state.regulationStartedAtMs !== null;
  const handleFinishRegulation = () => {
    if (finishMode.mode === 'finish') {
      void flow.finishRegulation();
    }
  };

  const handleSkipRemaining = () => {
    if (finishMode.mode !== 'requires-skip') {
      return;
    }
    const remainingAtConfirm = remainingRegulationSeconds(state, Date.now()) ?? 0;

    void confirm({
      title: `跳过剩余${windowNoun}时长？`,
      description: `${windowNoun}计时还剩 ${formatCountdown(remainingAtConfirm)}，未达设定的最短时长。跳过后本次评价会记录“已跳过”标记。确定跳过并进入复测吗？`,
      confirmText: '确认跳过并进入复测',
      destructive: true,
    }).then((confirmed) => {
      if (confirmed) {
        void flow.skipRemainingRegulation();
      }
    });
  };

  const handleBeginInduction = async () => {
    if (flow.inductionStatus.kind !== 'ready') {
      return;
    }

    const allowed = await flow.beginInduction();
    if (allowed && !getParadigmSessionStatus().active) {
      startInductionPlayback();
    }
  };

  // The flow hook's callbacks are useCallback-stable, so destructuring keeps
  // the identities without depending on the per-render `flow` object itself.
  const { playbackError, loadSummary } = flow;
  const handleInductionVideoError = useCallback(() => {
    setInductionVideoFailed(true);
    playbackError();
  }, [setInductionVideoFailed, playbackError]);

  const handleRetrySummary = useCallback(() => void loadSummary(), [loadSummary]);
  const { currentNode, doneNodes, pipelineNodes } = useEffectPipelineNodes(
    state,
    flow.summary !== null,
  );
  usePublishWorkspaceCommands(
    '/effect-evaluation',
    getEvaluationCommands({
      currentNode,
      interrupted: state.interrupted,
      showingHistory: !participantStage && activeTab === 'history',
      showHistory: (show) => setActiveTab(show ? 'history' : 'wizard'),
      openSettings: () => navigate('/experiment-settings'),
      openScale:
        measurementKey && !isScaleDialogOpen && !flow.isSavingScale && !state.interrupted
          ? () => setDismissedMeasurement(null)
          : null,
    }),
  );

  const handleStationClick = useCallback<EffectStationClick>(
    (step, anchorEl) => {
      if (step === state.step) {
        stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      if (step < state.step) {
        setReview({ step, anchorEl });
      }
    },
    [state.step],
  );

  const openReview = useCallback<EffectStationClick>((step, anchorEl) => {
    setReview({ step, anchorEl });
  }, []);

  const closeReview = useCallback(() => setReview(null), []);

  const eventLogUnavailableHint = <EventLogUnavailableHint />;

  const renderScalePanel = (phase: 'pre_induction' | 'baseline' | 'post') => (
    <ScaleStepPanel
      flow={flow}
      phase={phase}
      skippedCopy={skippedCopy}
      isDialogOpen={isScaleDialogOpen}
      onOpenDialog={() => setDismissedMeasurement(null)}
      onCloseDialog={() => setDismissedMeasurement(measurementKey)}
    />
  );

  const renderStageBody = (step: EffectFlowStep): ReactNode => {
    switch (step) {
      case 0:
        return <SetupStepPanel />;
      case 1:
        if (beforeInduction && state.runId && !flow.isStartingRun)
          return renderScalePanel('pre_induction');
        return (
          <InductionStepPanel
            flow={flow}
            eventLogUnavailableHint={eventLogUnavailableHint}
            isInductionPlaying={isInductionPlaying}
            inductionVideoFailed={inductionVideoFailed}
            inductionRetryCount={inductionRetryCount}
            onBeginInduction={handleBeginInduction}
            onResetFlow={handleResetFlow}
            onRetryInductionVideo={retryInductionVideo}
            onVideoError={handleInductionVideoError}
          />
        );
      case 2:
        return renderScalePanel('baseline');
      case 3:
        return (
          <ConditionStepPanel
            flow={flow}
            finishMode={finishMode}
            windowNoun={windowNoun}
            isNaturalRecovery={isNaturalRecovery}
            methodLabel={methodLabel}
            skippedCopy={skippedCopy}
            isWindowElapsed={isWindowElapsed}
            onResetFlow={handleResetFlow}
            onWindowElapsed={handleWindowElapsed}
            onFinishRegulation={handleFinishRegulation}
            onSkipRemaining={handleSkipRemaining}
            eventLogUnavailableHint={eventLogUnavailableHint}
          />
        );
      case 4:
        return renderScalePanel('post');
      case 5:
        return (
          <div className={styles.resultStep}>
            {flow.summaryError ? (
              <Alert severity="error" action={<Button onClick={handleRetrySummary}>重试</Button>}>
                {flow.summaryError}
              </Alert>
            ) : flow.summary ? (
              <>
                <EmotionChangeTable
                  changes={flow.summary.emotionChanges}
                  emotion={state.emotion}
                  condition={state.condition}
                />
                {skippedCopy && <Alert severity="info">{skippedCopy}</Alert>}
                <div className={styles.headerActions}>
                  <Button disabled={isExporting} onClick={handleExportSingleCsv}>
                    导出 CSV
                  </Button>
                  <Button disabled={isExporting} onClick={handleExportSingleJson}>
                    导出 JSON
                  </Button>
                </div>
              </>
            ) : (
              <p role="status">正在读取情绪评分…</p>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Box
      data-participant-stage={participantStage || undefined}
      className={styles.workspace}
      aria-label="情绪调控效果评价"
    >
      {!participantStage && (
        <header className={styles.header}>
          <div className={styles.headerMain}>
            <div>
              <div className={styles.eyebrow}>效果评价闭环</div>
              <h1 className={styles.title}>情绪调控效果评价</h1>
            </div>
            {activeTab === 'history' && (
              <div className={styles.headerActions}>
                <Button
                  variant="outlined"
                  disabled={isExporting}
                  onClick={() => void runBatchExport()}
                >
                  批量汇总导出（CSV）
                </Button>
              </div>
            )}
          </div>

          {isResultStep && (
            <div className={styles.contextBar} aria-label="实验上下文">
              <span className={styles.configChip}>被试 {state.subjectId.trim() || '未填写'}</span>
              <span className={styles.configChip}>时长 {state.durationMinutes} 分钟</span>
              <span className={styles.configChip}>
                {state.runMode === 'formal' ? '正式实验' : '排练，不发送硬件标记'}
                {state.runId ? ` · ${state.runId.slice(0, 8)}` : ''}
              </span>
              {state.eventLogStatus !== 'not-started' ? (
                <span
                  role="status"
                  className={`${styles.eventLogChip} ${
                    state.eventLogStatus === 'saved'
                      ? styles.eventLogSaved
                      : state.eventLogStatus === 'active'
                        ? styles.eventLogRecording
                        : styles.eventLogUnavailable
                  }${state.eventLogStatus === 'interrupted' ? ` ${styles.eventLogBadgeProminent}` : ''}`}
                >
                  {describeEventLogStatus(state.eventLogStatus)}
                </span>
              ) : null}
            </div>
          )}
        </header>
      )}

      {exportNotice ? (
        <Alert severity={exportNotice.severity} onClose={() => setExportNotice(null)}>
          {exportNotice.text}
        </Alert>
      ) : null}

      {!participantStage && (
        <Tabs
          value={activeTab}
          onChange={(_event, next: PageTab) => setActiveTab(next)}
          aria-label="效果评价视图切换"
          className={styles.tabBar}
        >
          <Tab value="wizard" label="评价向导" />
          <Tab value="history" label="历史记录" />
        </Tabs>
      )}

      {/* The wizard pane stays MOUNTED on both tabs (hidden, not unmounted):
          unmounting it on the history tab would silently stop the induction
          video / the embedded regulation media mid-window while the
          wall-clock countdown kept running — and the music branch would lose
          its selection on return (component state dies with the mount). */}
      <div className={styles.wizardPane} hidden={!participantStage && activeTab !== 'wizard'}>
        {/* Resumed-run banner (audit 1): names the restored step, the subject
            binding, and the one fact a reload could plausibly hide — that a
            live condition window kept running on wall-clock time. */}
        {isResultStep && flow.isResumedRun && !isResumeNoticeDismissed ? (
          <Alert severity="info" onClose={() => setIsResumeNoticeDismissed(true)}>
            已恢复上次完成的评价，可以查看结果或开始下一次实验。
          </Alert>
        ) : null}

        {/* Collapsible progress disclosure (round 7): the six-station
            timeline lives behind one light pill row instead of squatting
            above the stage on every step. It blooms briefly on step
            changes, stays while pinned open, and force-collapses whenever
            the scale dialog opens (scaleDialogOpen). Station/chip clicks
            keep their review/scroll semantics inside the panel. */}
        {isResultStep && (
          <EffectProgressDisclosure
            nodes={pipelineNodes}
            doneNodes={doneNodes}
            onStationClick={handleStationClick}
            onChipClick={openReview}
            scaleDialogOpen={isScaleDialogOpen}
            step={state.step}
          />
        )}

        {/* Main stage: exactly one task at a time. The kicker orients
            (步骤 X / 6), the title/hint say what to do, the panel's single
            primary CTA does it. */}
        <section
          ref={stageRef}
          tabIndex={-1}
          className={`${styles.stage}${state.step === 5 ? ` ${styles.stageFlat}` : ''}`}
          aria-label="当前任务"
        >
          {/* Keyed by the flow step: each advance replays one short rise
              (.stageSwap). The countdown branch stays INSIDE the wrapper so
              its own appearing/disappearing never re-triggers the entrance. */}
          <div key={state.step} className={styles.stageSwap}>
            <p className={styles.stageKicker}>
              步骤 {state.step + 1} / {EFFECT_FLOW_STEP_COUNT}
            </p>
            {/* While the condition window runs the countdown digits are the
                headline — the title/hint step aside. */}
            {!isWindowRunning ? (
              <>
                <h2 className={styles.stageTitle}>{currentNode.stageTitle}</h2>
                <p className={styles.stageHint}>{currentNode.stageHint}</p>
              </>
            ) : null}

            {renderStageBody(state.step)}
            {isResultStep && state.runMode === 'formal' && state.runId && (
              <ResultBdfAttachment key={state.runId} runId={state.runId} />
            )}
          </div>

          {/* Destructive reset lives in the quiet footer row, visually
              far from every primary CTA. At the result step the same
              action IS the path to the next run, so the label says that
              instead of a bare 重置流程 (the confirm states what is
              kept/discarded either way). */}
          {state.step > 0 ? (
            <div className={styles.stageFooterRow}>
              <button type="button" className={styles.secondaryAction} onClick={handleResetFlow}>
                {state.step === 5 ? '完成本次评价，开始下一次' : '重置流程'}
              </button>
            </div>
          ) : null}
        </section>
      </div>

      {!participantStage && activeTab === 'history' ? <EffectHistoryPanel /> : null}

      <EffectReviewPopover
        review={review}
        state={state}
        methodLabel={methodLabel}
        skippedCopy={skippedCopy}
        onClose={closeReview}
      />

      {confirmDialogElement}
    </Box>
  );
}
