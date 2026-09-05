import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { getParadigmSessionStatus } from '../../eeg/paradigm/paradigmSessionStatus';
import { useConfirmDialog } from '../../ui/useConfirmDialog';
import {
  buildConditionComparisonVerdictCopy, buildEffectVerdictCopy, describeMeasuredBasis,
  describeRegulationSkipped, EFFECT_EMOTION_OPTIONS, EFFECT_FLOW_STEP_COUNT, EFFECT_METHOD_OPTIONS,
  formatCountdown, labelForCondition, regulationFinishModeFromRemaining,
  remainingRegulationSeconds, type EffectFlowStep,
} from './effectEvaluationFlow';
import { describeEegAssociation, verdictCopyForCondition } from './effectPipeline';
import {
  buildConditionComparisonChartOption, buildEffectChartOption,
} from './effectResultChartOption';
import { ConditionComparisonCard, ResultCard } from './EffectResultCards';
import {
  ConditionStepPanel, EegUnavailableHint, InductionStepPanel, ScaleStepPanel, SetupStepPanel,
} from './EffectStepPanels';
import EffectDeviceQuickStart from './EffectDeviceQuickStart';
import EffectHistoryPanel from './EffectHistoryPanel';
import { EffectReviewPopover } from './EffectReviewPopover';
import { EffectDoneBand, EffectTimeline, type EffectReviewTarget, type EffectStationClick } from './EffectTimeline';
import { useEffectEvaluationFlow } from './useEffectEvaluationFlow';
import { useEffectPipelineNodes } from './useEffectPipelineNodes';
import { useEffectReportExports } from './useEffectReportExports';
import { useInductionPlayback } from './useInductionPlayback';
import styles from './EffectEvaluation.module.css';

/**
 * Effect-evaluation loop, built for 10-second onboarding. The page reads top
 * down as: (1) a compact experiment banner (run facts + EEG badge + device
 * quick start, no forms), (2) the horizontal timeline — the visual
 * protagonist showing where the run is, (3) the compression band of finished
 * nodes, and (4) ONE main-stage card always presenting the current task with
 * a single primary CTA.
 *
 * Layer split: status/stage copy derivation lives in the pure `effectPipeline`
 * module; the flow state machine and handlers stay untouched in
 * `useEffectEvaluationFlow`; step interaction areas are the stage panels in
 * `EffectStepPanels`; finished nodes are reviewed through the read-only
 * `EffectReviewPopover`.
 *
 * Performance contract: this page renders only on real state changes — no
 * component above the countdown re-renders on the wall clock. The condition
 * window's 500ms poll lives entirely inside the self-contained
 * `ConditionCountdown` leaf (`EffectConditionCountdown.tsx`), which ticks its
 * own digits (identical integer seconds bail out of the update, so it renders
 * at ~1Hz) and reports expiry upward exactly once via `onWindowElapsed`; the
 * page flips the finish gate with that one-shot fact instead of tracking
 * `remainingSeconds` per tick. On top of that, `EffectTimeline` /
 * `EffectDoneBand` are memoized on stable props (node array derived from the
 * specific state fields the pipeline reads + stable callbacks) and bail out
 * on unrelated page re-renders; the ticking digits are confined to the
 * countdown leaf; result cards are memoized and receive only stable props.
 */

type PageTab = 'wizard' | 'history';

export default function EffectEvaluation() {
  const flow = useEffectEvaluationFlow();
  const { state } = flow;
  const { confirm, confirmDialogElement } = useConfirmDialog();
  // Steps 2/4 present the shared gate dialog on demand; closing it only
  // dismisses the dialog, it never touches the flow itself.
  const [isScaleDialogOpen, setIsScaleDialogOpen] = useState(false);
  // Induction video playback state (play flag, mid-run failure + retry
  // counter, step-change reset) lives in its own hook.
  const {
    inductionRetryCount, inductionVideoFailed, isInductionPlaying,
    retryInductionVideo, setInductionVideoFailed, startInductionPlayback,
  } = useInductionPlayback(state.step);
  const [activeTab, setActiveTab] = useState<PageTab>('wizard');
  // Report exports (single / batch / cross-condition comparison) share one
  // busy flag + notice through the export hook, which also owns the stable
  // per-card export callbacks.
  const {
    exportNotice, handleExportComparisonCsv, handleExportComparisonJson,
    handleExportSingleCsv, handleExportSingleJson, isExporting,
    runBatchExport, setExportNotice,
  } = useEffectReportExports({
    subjectId: state.subjectId,
    emotion: state.emotion,
    baselineRecordId: state.baselineRecordId,
    postRecordId: state.postRecordId,
  });
  // Read-only review overlay for a completed node, anchored to the timeline
  // station / done-band chip that opened it.
  const [review, setReview] = useState<EffectReviewTarget | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  // Reload recovery (audit 1): sessionStorage restores a mid-run state
  // silently — without a notice the operator cannot tell a resumed run from
  // a fresh page (is the countdown real? was the scale already filled?).
  const [isResumeNoticeDismissed, setIsResumeNoticeDismissed] = useState(false);
  // One-shot expiry fact of the condition window, reported by the
  // self-contained ConditionCountdown leaf (the page itself never polls the
  // wall clock). Flips the finish gate and the embedded player's to-zero
  // pause exactly once per window. Initialized from the wall clock so a run
  // resumed AFTER its window elapsed unlocks immediately; cleared on reset.
  const [isWindowElapsed, setIsWindowElapsed] = useState(() => {
    const remaining = remainingRegulationSeconds(state, Date.now());
    return remaining !== null && remaining <= 0;
  });
  const handleWindowElapsed = useCallback(() => setIsWindowElapsed(true), []);

  const emotionLabel = EFFECT_EMOTION_OPTIONS.find((option) => option.value === state.emotion)?.label
    ?? state.emotion;
  const methodLabel = EFFECT_METHOD_OPTIONS.find((option) => option.value === state.method)?.label
    ?? state.method;
  const isNaturalRecovery = state.condition === 'natural_recovery';
  // Result-screen noun per condition (R6): the natural-recovery leg regulates
  // nothing, so its post column / chart series read 静息后 instead of 调控后.
  const postLabel = isNaturalRecovery ? '静息后' : '调控后';

  // Step transitions (audit 2): when the stage advances (①→②, ④→⑤, …) the
  // new task must land in view instead of waiting to be hunted down, and
  // keyboard/screen-reader focus moves off the (now unmounted) trigger into
  // the stage. The initial mount — including a restored run — keeps the
  // natural scroll position.
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

  // Resetting discards the whole run (a linked EEG recording is stopped as
  // part of it) — a destructive action on par with the skip flow, so it gets
  // the same explicit confirmation instead of firing on a misclick. At the
  // result step nothing is running anymore and the next task is a fresh run,
  // so the dialog is framed as "start the next one" while stating the same
  // what-is-kept facts.
  const isResultStep = state.step === 5;
  const handleResetFlow = async () => {
    const confirmed = await confirm({
      title: isResultStep ? '开始下一次评价' : '重置评价流程',
      description: isResultStep
        ? '将清空向导的当前进度并开始一次全新的评价；已保存的量表记录与 EEG 会话不受影响，历史记录照常可查。'
        : '重置将停止本次运行关联的 EEG 记录并丢弃当前进度；已保存的量表记录仍会保留在历史记录中。确定要重置吗？',
      confirmText: isResultStep ? '清空并开始下一次' : '停止并重置',
      destructive: true,
    });

    if (confirmed) {
      setReview(null);
      // The fresh run is NOT a resumed one — retire the resume banner with
      // the run it described.
      setIsResumeNoticeDismissed(true);
      // A fresh run's window has not elapsed: clear the one-shot expiry fact
      // so the next condition step starts with its finish gate locked.
      setIsWindowElapsed(false);
      flow.resetFlow();
    }
  };

  // Strong duration constraint (R3): the countdown is a hard floor - the
  // normal finish unlocks only at zero, earlier exits go through the
  // double-confirmed skip which records the marker with the run. The gate
  // rides the one-shot expiry fact (`isWindowElapsed`, reported by the
  // countdown leaf) instead of a per-tick remaining value: the wall clock is
  // read here only on dispatch-driven renders, never on a 500ms tick.
  const finishMode = regulationFinishModeFromRemaining(
    state.regulationStartedAtMs === null
      ? null
      : isWindowElapsed ? 0 : remainingRegulationSeconds(state, Date.now()),
  );
  const skippedCopy = describeRegulationSkipped(state);
  // Noun swapped in the countdown copy: 静息 for the natural-recovery
  // condition, 调控 for the regulation condition.
  const windowNoun = isNaturalRecovery ? '静息' : '调控';
  // While the window runs the stage's headline yields to the countdown digits
  // (the countdown's own status pill carries the running state).
  const isWindowRunning = state.step === 3 && state.regulationStartedAtMs !== null;

  // The shared verdict builder rephrased per condition (a natural-recovery
  // leg must not claim “本次调控判定为有效”).
  const verdictCopy = useMemo(
    () => (flow.summary
      ? verdictCopyForCondition(buildEffectVerdictCopy(flow.summary), state.condition)
      : null),
    [flow.summary, state.condition],
  );
  // R4/F1 口径: marker-based means need no extra copy; legacy pairs computed
  // over every stored key are flagged so the compared-dimension count is not
  // mistaken for "all four dimensions were measured".
  const measuredBasisNote = flow.summary ? describeMeasuredBasis(flow.summary) : null;
  const chartOption = useMemo(
    () => (flow.summary && flow.summary.dimensions.length > 0
      ? buildEffectChartOption(flow.summary, postLabel)
      : null),
    [flow.summary, postLabel],
  );

  // Cross-condition comparison (R6, 大纲 6.2): verdict, basis note, chart.
  const comparisonVerdictCopy = useMemo(
    () => (flow.conditionComparison ? buildConditionComparisonVerdictCopy(flow.conditionComparison) : null),
    [flow.conditionComparison],
  );
  const comparisonMeasuredBasisNote = flow.conditionComparison
    ? describeMeasuredBasis(flow.conditionComparison)
    : null;
  const comparisonChartOption = useMemo(
    () => (flow.conditionComparison && flow.conditionComparison.dimensions.length > 0
      ? buildConditionComparisonChartOption(flow.conditionComparison)
      : null),
    [flow.conditionComparison],
  );

  /** Normal exit - only offered once the countdown reached zero. */
  const handleFinishRegulation = () => {
    if (finishMode.mode === 'finish') {
      void flow.finishRegulation();
    }
  };

  /** Escape hatch requiring a second confirmation; marks the run as skipped. */
  const handleSkipRemaining = () => {
    if (finishMode.mode !== 'requires-skip') {
      return;
    }

    // The remaining time is read off the wall clock at confirm-dialog time —
    // the page does not track it per tick, so this names the seconds
    // actually left when the operator asked to skip.
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

  /** Node 1 entry: starts the EEG association, then mounts the player. */
  const handleBeginInduction = () => {
    if (flow.inductionStatus.kind !== 'ready') {
      return;
    }

    flow.beginInduction();

    // A live paradigm session blocks the EEG association (the hook shows its
    // own error banner); the video must not start behind that guard either.
    if (!getParadigmSessionStatus().active) {
      startInductionPlayback();
    }
  };

  const handleInductionVideoError = useCallback(() => {
    setInductionVideoFailed(true);
  }, [setInductionVideoFailed]);

  const handleRetrySummary = useCallback(() => void flow.loadSummary(), [flow.loadSummary]);
  const handleRetryComparison = useCallback(() => void flow.loadConditionComparison(), [flow.loadConditionComparison]);

  // Timeline view-model (memoized on the fields the pure pipeline reads, see
  // the hook) + the compressed strip of finished nodes.
  const { currentNode, doneNodes, pipelineNodes } = useEffectPipelineNodes(
    state,
    flow.summary !== null,
  );

  /** Timeline station click: current → scroll the stage into view, done →
   *  read-only review popover (pending stations are disabled upstream). */
  const handleStationClick = useCallback<EffectStationClick>((step, anchorEl) => {
    if (step === state.step) {
      stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (step < state.step) {
      setReview({ step, anchorEl });
    }
  }, [state.step]);

  const openReview = useCallback<EffectStationClick>((step, anchorEl) => {
    setReview({ step, anchorEl });
  }, []);

  const closeReview = useCallback(() => setReview(null), []);

  const eegUnavailableHint = <EegUnavailableHint />;

  /** Shared invocation for nodes 2/4 — the two phases differ only in `phase`. */
  const renderScalePanel = (phase: 'baseline' | 'post') => (
    <ScaleStepPanel
      flow={flow} phase={phase} skippedCopy={skippedCopy}
      isDialogOpen={isScaleDialogOpen}
      onOpenDialog={() => setIsScaleDialogOpen(true)} onCloseDialog={() => setIsScaleDialogOpen(false)}
    />
  );

  /** The main stage's interactive area — built only for the current node. */
  const renderStageBody = (step: EffectFlowStep): ReactNode => {
    switch (step) {
      case 0:
        return <SetupStepPanel flow={flow} />;
      case 1:
        return (
          <InductionStepPanel
            flow={flow} eegUnavailableHint={eegUnavailableHint}
            isInductionPlaying={isInductionPlaying} inductionVideoFailed={inductionVideoFailed}
            inductionRetryCount={inductionRetryCount} onBeginInduction={handleBeginInduction}
            onResetFlow={handleResetFlow} onRetryInductionVideo={retryInductionVideo}
            onVideoError={handleInductionVideoError}
          />
        );
      case 2:
        return renderScalePanel('baseline');
      case 3:
        return (
          <ConditionStepPanel
            flow={flow} finishMode={finishMode} windowNoun={windowNoun} isNaturalRecovery={isNaturalRecovery}
            methodLabel={methodLabel} skippedCopy={skippedCopy}
            isWindowElapsed={isWindowElapsed} onWindowElapsed={handleWindowElapsed}
            onFinishRegulation={handleFinishRegulation} onSkipRemaining={handleSkipRemaining}
            eegUnavailableHint={eegUnavailableHint}
          />
        );
      case 4:
        return renderScalePanel('post');
      case 5:
        return (
          <div className={styles.resultStep}>
            <ResultCard
              chartOption={chartOption} eegSessionId={state.eegSessionId}
              isLoadingSummary={flow.isLoadingSummary} isExporting={isExporting}
              measuredBasisNote={measuredBasisNote} postLabel={postLabel}
              skippedCopy={skippedCopy}
              onExportCsv={handleExportSingleCsv} onExportJson={handleExportSingleJson}
              onRetry={handleRetrySummary} summary={flow.summary}
              summaryError={flow.summaryError} verdictCopy={verdictCopy}
            />
            <ConditionComparisonCard
              chartOption={comparisonChartOption} comparisonError={flow.conditionComparisonError}
              conditionComparison={flow.conditionComparison}
              isLoadingComparison={flow.isLoadingConditionComparison} isExporting={isExporting}
              measuredBasisNote={comparisonMeasuredBasisNote}
              onExportCsv={handleExportComparisonCsv} onExportJson={handleExportComparisonJson}
              onRetry={handleRetryComparison} verdictCopy={comparisonVerdictCopy}
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

        {/* Experiment banner: run facts + EEG association badge, so the
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
          {state.eegAssociation !== 'not-started' ? (
            <span
              role="status"
              className={`${styles.eegChip} ${
                state.eegAssociation === 'saved'
                  ? styles.eegSaved
                  : state.eegAssociation === 'recording' ? styles.eegRecording : styles.eegUnavailable
              }${state.eegAssociation === 'unavailable' ? ` ${styles.eegBadgeProminent}` : ''}`}
            >
              {describeEegAssociation(state.eegAssociation)}
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

        <EffectTimeline nodes={pipelineNodes} onStationClick={handleStationClick} />

        {/* Finished nodes shrink into this strip; the stage below never
            renders them. Chips open the same review popover as stations. */}
        <EffectDoneBand doneNodes={doneNodes} onChipClick={openReview} />

        {/* Main stage: exactly one task at a time. The kicker orients
            (步骤 X / 6), the title/hint say what to do, the panel's single
            primary CTA does it. */}
        <section
          ref={stageRef}
          tabIndex={-1}
          className={`${styles.stage}${state.step === 5 ? ` ${styles.stageFlat}` : ''}`}
          aria-label="当前任务"
        >
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
        review={review} state={state} emotionLabel={emotionLabel}
        methodLabel={methodLabel} skippedCopy={skippedCopy} onClose={closeReview}
      />

      {confirmDialogElement}
    </Box>
  );
}
