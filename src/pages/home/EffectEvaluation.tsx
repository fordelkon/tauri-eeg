import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { getParadigmSessionStatus } from '../../paradigm/paradigmSessionStatus';
import { useConfirmDialog } from '../../ui/useConfirmDialog';
import {
  buildConditionComparisonVerdictCopy,
  buildEffectVerdictCopy,
  describeMeasuredBasis,
  describeRegulationSkipped,
  EFFECT_EMOTION_OPTIONS,
  EFFECT_FLOW_STEP_COUNT,
  EFFECT_METHOD_OPTIONS,
  formatCountdown,
  labelForCondition,
  remainingRegulationSeconds,
  type EffectFlowStep,
} from './effectEvaluationFlow';
import { describeEventLogStatus, verdictCopyForCondition } from './effectPipeline';
import {
  buildConditionComparisonChartOption,
  buildEffectChartOption,
} from './effectResultChartOption';
import { ConditionComparisonCard, ResultCard } from './EffectResultCards';
import {
  ConditionStepPanel,
  EventLogUnavailableHint,
  InductionStepPanel,
  ScaleStepPanel,
  SetupStepPanel,
} from './EffectStepPanels';
import EffectDeviceQuickStart from './EffectDeviceQuickStart';
import EffectHistoryPanel from './EffectHistoryPanel';
import { EffectReviewPopover } from './EffectReviewPopover';
import type { EffectReviewTarget, EffectStationClick } from './EffectTimeline';
import { EffectProgressDisclosure } from './EffectProgressDisclosure';
import { useEffectEvaluationFlow } from './useEffectEvaluationFlow';
import { useEffectPipelineNodes } from './useEffectPipelineNodes';
import { useEffectReportExports } from './useEffectReportExports';
import { useInductionPlayback } from './useInductionPlayback';
import styles from './EffectEvaluation.module.css';

type PageTab = 'wizard' | 'history';

export default function EffectEvaluation() {
  const flow = useEffectEvaluationFlow();
  const { state } = flow;
  const { confirm, confirmDialogElement } = useConfirmDialog();
  const [isScaleDialogOpen, setIsScaleDialogOpen] = useState(false);
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
    handleExportComparisonCsv,
    handleExportComparisonJson,
    handleExportSingleCsv,
    handleExportSingleJson,
    isExporting,
    runBatchExport,
    setExportNotice,
  } = useEffectReportExports({
    subjectId: state.subjectId,
    emotion: state.emotion,
    baselineRecordId: state.baselineRecordId,
    postRecordId: state.postRecordId,
  });
  const [review, setReview] = useState<EffectReviewTarget | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const [isResumeNoticeDismissed, setIsResumeNoticeDismissed] = useState(false);
  const { isWindowElapsed } = flow;
  useEffect(() => {
    if (state.runId === null) setIsScaleDialogOpen(false);
  }, [state.runId]);
  const handleWindowElapsed = flow.conditionElapsed;
  const emotionLabel =
    EFFECT_EMOTION_OPTIONS.find((option) => option.value === state.emotion)?.label ?? state.emotion;
  const methodLabel =
    EFFECT_METHOD_OPTIONS.find((option) => option.value === state.method)?.label ?? state.method;
  const isNaturalRecovery = state.condition === 'natural_recovery';
  const postLabel = isNaturalRecovery ? '静息后' : '调控后';
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
      flow.resetFlow();
    }
  };
  const finishMode = flow.regulationFinishMode();
  const skippedCopy = describeRegulationSkipped(state);
  const windowNoun = isNaturalRecovery ? '静息' : '调控';
  const isWindowRunning = state.step === 3 && state.regulationStartedAtMs !== null;
  const verdictCopy = useMemo(
    () =>
      flow.summary
        ? verdictCopyForCondition(buildEffectVerdictCopy(flow.summary), state.condition)
        : null,
    [flow.summary, state.condition],
  );
  const measuredBasisNote = flow.summary ? describeMeasuredBasis(flow.summary) : null;
  const chartOption = useMemo(
    () =>
      flow.summary && flow.summary.dimensions.length > 0
        ? buildEffectChartOption(flow.summary, postLabel)
        : null,
    [flow.summary, postLabel],
  );
  const comparisonVerdictCopy = useMemo(
    () =>
      flow.conditionComparison
        ? buildConditionComparisonVerdictCopy(flow.conditionComparison)
        : null,
    [flow.conditionComparison],
  );
  const comparisonMeasuredBasisNote = flow.conditionComparison
    ? describeMeasuredBasis(flow.conditionComparison)
    : null;
  const comparisonChartOption = useMemo(
    () =>
      flow.conditionComparison && flow.conditionComparison.dimensions.length > 0
        ? buildConditionComparisonChartOption(flow.conditionComparison)
        : null,
    [flow.conditionComparison],
  );

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
      description: `${windowNoun}计时还剩 ${formatCountdown(remainingAtConfirm)}，未达设定的最短时长。跳过后本次评价会记录“已跳过”标记，改善率可能低估实际效果。确定跳过并进入复测吗？`,
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
  const { playbackError, loadSummary, loadConditionComparison } = flow;
  const handleInductionVideoError = useCallback(() => {
    setInductionVideoFailed(true);
    playbackError();
  }, [setInductionVideoFailed, playbackError]);

  const handleRetrySummary = useCallback(() => void loadSummary(), [loadSummary]);
  const handleRetryComparison = useCallback(
    () => void loadConditionComparison(),
    [loadConditionComparison],
  );
  const { currentNode, doneNodes, pipelineNodes } = useEffectPipelineNodes(
    state,
    flow.summary !== null,
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

  const renderScalePanel = (phase: 'baseline' | 'post') => (
    <ScaleStepPanel
      flow={flow}
      phase={phase}
      skippedCopy={skippedCopy}
      isDialogOpen={isScaleDialogOpen}
      onOpenDialog={() => setIsScaleDialogOpen(true)}
      onCloseDialog={() => setIsScaleDialogOpen(false)}
    />
  );

  const renderStageBody = (step: EffectFlowStep): ReactNode => {
    switch (step) {
      case 0:
        return <SetupStepPanel flow={flow} />;
      case 1:
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
            <ResultCard
              chartOption={chartOption}
              runId={state.runId}
              isLoadingSummary={flow.isLoadingSummary}
              isExporting={isExporting}
              measuredBasisNote={measuredBasisNote}
              postLabel={postLabel}
              skippedCopy={skippedCopy}
              onExportCsv={handleExportSingleCsv}
              onExportJson={handleExportSingleJson}
              onRetry={handleRetrySummary}
              summary={flow.summary}
              summaryError={flow.summaryError}
              verdictCopy={verdictCopy}
            />
            <ConditionComparisonCard
              chartOption={comparisonChartOption}
              comparisonError={flow.conditionComparisonError}
              conditionComparison={flow.conditionComparison}
              isLoadingComparison={flow.isLoadingConditionComparison}
              isExporting={isExporting}
              measuredBasisNote={comparisonMeasuredBasisNote}
              onExportCsv={handleExportComparisonCsv}
              onExportJson={handleExportComparisonJson}
              onRetry={handleRetryComparison}
              verdictCopy={comparisonVerdictCopy}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Box className={styles.workspace} aria-label="情绪调控效果评价">
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <div>
            <div className={styles.eyebrow}>效果评价闭环</div>
            <h1 className={styles.title}>情绪调控效果评价</h1>
          </div>
          <div className={styles.headerActions}>
            <Button variant="outlined" disabled={isExporting} onClick={() => void runBatchExport()}>
              批量汇总导出（CSV）
            </Button>
          </div>
        </div>

        {/* Experiment banner: run facts + experiment event log badge, so the
            trial-run state is visible before any node is entered. No forms
            here — configuration happens in the stage's first node. The
            regulation-method chip only renders for the regulation condition:
            on a natural-recovery run the method is unused, and showing it
            next to 基线条件（自然恢复） reads as a misconfiguration. */}
        <div className={styles.contextBar} aria-label="实验上下文">
          <span className={styles.configChip}>被试 {state.subjectId.trim() || '未填写'}</span>
          <span className={styles.configChip}>目标情绪 {emotionLabel}</span>
          {state.condition !== 'natural_recovery' ? (
            <span className={styles.configChip}>{methodLabel}</span>
          ) : null}
          <span className={styles.configChip}>{labelForCondition(state.condition)}</span>
          <span className={styles.configChip}>时长 {state.durationMinutes} 分钟</span>
          <EffectDeviceQuickStart />
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
      </header>

      {exportNotice ? (
        <Alert severity={exportNotice.severity} onClose={() => setExportNotice(null)}>
          {exportNotice.text}
        </Alert>
      ) : null}

      <Tabs
        value={activeTab}
        onChange={(_event, next: PageTab) => setActiveTab(next)}
        aria-label="效果评价视图切换"
        className={styles.tabBar}
      >
        <Tab value="wizard" label="评价向导" />
        <Tab value="history" label="历史记录" />
      </Tabs>

      {/* The wizard pane stays MOUNTED on both tabs (hidden, not unmounted):
          unmounting it on the history tab would silently stop the induction
          video / the embedded regulation media mid-window while the
          wall-clock countdown kept running — and the music branch would lose
          its selection on return (component state dies with the mount). */}
      <div className={styles.wizardPane} hidden={activeTab !== 'wizard'}>
        {/* Resumed-run banner (audit 1): names the restored step, the subject
            binding, and the one fact a reload could plausibly hide — that a
            live condition window kept running on wall-clock time. */}
        {flow.isResumedRun && !isResumeNoticeDismissed ? (
          <Alert severity="info" onClose={() => setIsResumeNoticeDismissed(true)}>
            {`已恢复上次进行中的评价：当前在第 ${state.step + 1}/${EFFECT_FLOW_STEP_COUNT} 步（${currentNode.title}）· 被试 ${
              state.subjectId.trim() || '未填写'
            }。${isWindowRunning ? '条件计时按真实时间继续计算，请留意剩余时长。' : '可从当前步骤继续；如需重新开始，请使用舞台下方的「重置流程」。'}`}
          </Alert>
        ) : null}

        {/* Collapsible progress disclosure (round 7): the six-station
            timeline lives behind one light pill row instead of squatting
            above the stage on every step. It blooms briefly on step
            changes, stays while pinned open, and force-collapses whenever
            the scale dialog opens (scaleDialogOpen). Station/chip clicks
            keep their review/scroll semantics inside the panel. */}
        <EffectProgressDisclosure
          nodes={pipelineNodes}
          doneNodes={doneNodes}
          onStationClick={handleStationClick}
          onChipClick={openReview}
          scaleDialogOpen={isScaleDialogOpen}
          step={state.step}
        />

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
              步骤 {state.step + 1} / {EFFECT_FLOW_STEP_COUNT} · {currentNode.title}
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

      {activeTab === 'history' ? <EffectHistoryPanel /> : null}

      <EffectReviewPopover
        review={review}
        state={state}
        emotionLabel={emotionLabel}
        methodLabel={methodLabel}
        skippedCopy={skippedCopy}
        onClose={closeReview}
      />

      {confirmDialogElement}
    </Box>
  );
}
