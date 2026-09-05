import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { save } from '@tauri-apps/plugin-dialog';
import { getParadigmSessionStatus } from '../../eeg/paradigm/paradigmSessionStatus';
import { exportEffectReport } from '../../mentalScale/scaleRecordsApi';
import { useConfirmDialog } from '../../ui/useConfirmDialog';
import { describeFriendlyError } from '../../ui/friendlyError';
import {
  buildConditionComparisonVerdictCopy, buildEffectVerdictCopy, describeMeasuredBasis,
  describeRegulationSkipped, EFFECT_EMOTION_OPTIONS, EFFECT_METHOD_OPTIONS, formatCountdown,
  labelForCondition, regulationFinishModeFromRemaining, type EffectFlowStep,
} from './effectEvaluationFlow';
import {
  buildBatchReportPayload, buildComparisonReportPayload, buildSingleReportPayload,
  suggestReportFileName, type ExportReportFormat,
} from './effectReportExport';
import {
  describeEegAssociation, deriveEffectPipelineNodes, type EffectPipelineNode,
} from './effectPipeline';
import {
  buildConditionComparisonChartOption, buildEffectChartOption,
} from './effectResultChartOption';
import { ConditionComparisonCard, ResultCard } from './EffectResultCards';
import {
  ConditionStepPanel, EegUnavailableHint, InductionStepPanel, ScaleStepPanel, SetupStepPanel,
} from './EffectStepPanels';
import EffectDeviceQuickStart from './EffectDeviceQuickStart';
import { EffectPipelineCard, PipelineDoneDetails } from './EffectPipelineCard';
import EffectHistoryPanel from './EffectHistoryPanel';
import { useEffectEvaluationFlow } from './useEffectEvaluationFlow';
import styles from './EffectEvaluation.module.css';

/**
 * Single-page pipeline view of the effect-evaluation loop: the six steps
 * (0 配置 → 1 情绪诱发 → 2 诱发后量表 → 3 条件执行 → 4 条件后量表 → 5 结果评价)
 * render as always-visible node cards. Status/summary derivation lives in the
 * pure `effectPipeline` module, the flow state machine and handlers stay
 * untouched in `useEffectEvaluationFlow`, and the step interaction areas are
 * moved verbatim into `EffectStepPanels` / `EffectResultCards`.
 *
 * Performance contract: the hook's `nowMs` re-renders the page every 500ms
 * while the condition window runs. Every node card is memoized; only the
 * current node's card receives changing children, and the countdown digits
 * are confined to the memoized ConditionCountdown inside it — done/pending
 * cards bail out on stable props.
 */

type PageTab = 'wizard' | 'history';

type ExportNotice = { severity: 'success' | 'error'; text: string };

export default function EffectEvaluation() {
  const flow = useEffectEvaluationFlow();
  const { state } = flow;
  const { confirm, confirmDialogElement } = useConfirmDialog();
  // Steps 2/4 present the shared gate dialog on demand; closing it only
  // dismisses the dialog, it never touches the flow itself.
  const [isScaleDialogOpen, setIsScaleDialogOpen] = useState(false);
  // The induction video only mounts after the operator explicitly starts the
  // induction (EEG association + paradigm-session guard ride on that entry).
  const [isInductionPlaying, setIsInductionPlaying] = useState(false);
  // R7: a video that fails mid-run (file moved/corrupted) must not strand the
  // induction step - the error branch offers a remount retry or a way back.
  const [inductionVideoFailed, setInductionVideoFailed] = useState(false);
  const [inductionRetryCount, setInductionRetryCount] = useState(0);
  const [activeTab, setActiveTab] = useState<PageTab>('wizard');
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<ExportNotice | null>(null);
  // Which completed nodes show their detail block (collapsed by default).
  const [expandedDoneSteps, setExpandedDoneSteps] = useState<ReadonlySet<EffectFlowStep>>(() => new Set());

  const emotionLabel = EFFECT_EMOTION_OPTIONS.find((option) => option.value === state.emotion)?.label
    ?? state.emotion;
  const methodLabel = EFFECT_METHOD_OPTIONS.find((option) => option.value === state.method)?.label
    ?? state.method;
  const isNaturalRecovery = state.condition === 'natural_recovery';

  // Leaving the induction step (or resetting the flow) unmounts the player.
  useEffect(() => {
    if (state.step !== 1) {
      setIsInductionPlaying(false);
      setInductionVideoFailed(false);
    }
  }, [state.step]);

  // Resetting discards the whole run (a linked EEG recording is stopped as
  // part of it) — a destructive action on par with the skip flow, so it gets
  // the same explicit confirmation instead of firing on a misclick.
  const handleResetFlow = async () => {
    const confirmed = await confirm({
      title: '重置评价流程',
      description: '重置将停止本次运行关联的 EEG 记录并丢弃当前进度；已保存的量表记录仍会保留在历史记录中。确定要重置吗？',
      confirmText: '停止并重置',
      destructive: true,
    });

    if (confirmed) {
      setExpandedDoneSteps(new Set());
      flow.resetFlow();
    }
  };

  // Strong duration constraint (R3): the countdown is a hard floor - the
  // normal finish unlocks only at zero, earlier exits go through the
  // double-confirmed skip which records the marker with the run.
  const finishMode = regulationFinishModeFromRemaining(flow.remainingSeconds);
  const skippedCopy = describeRegulationSkipped(state);
  // Noun swapped in the countdown copy: 静息 for the natural-recovery
  // condition, 调控 for the regulation condition.
  const windowNoun = isNaturalRecovery ? '静息' : '调控';

  const verdictCopy = useMemo(
    () => (flow.summary ? buildEffectVerdictCopy(flow.summary) : null),
    [flow.summary],
  );
  // R4/F1 口径: marker-based means need no extra copy; legacy pairs computed
  // over every stored key are flagged so the compared-dimension count is not
  // mistaken for "all four dimensions were measured".
  const measuredBasisNote = flow.summary ? describeMeasuredBasis(flow.summary) : null;
  const chartOption = useMemo(
    () => (flow.summary && flow.summary.dimensions.length > 0 ? buildEffectChartOption(flow.summary) : null),
    [flow.summary],
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

    void confirm({
      title: `跳过剩余${windowNoun}时长？`,
      description: `${windowNoun}计时还剩 ${formatCountdown(finishMode.remainingSeconds)}，未达设定的最短时长。跳过后本次评价会记录“已跳过”标记，改善率可能低估实际效果。确定跳过并进入复测吗？`,
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
      setIsInductionPlaying(true);
    }
  };

  // R7: remounts the player after a load failure (the retry counter rides on
  // the element key so a fresh <video> re-fetches the file).
  const handleRetryInductionVideo = () => {
    setInductionVideoFailed(false);
    setInductionRetryCount((count) => count + 1);
    setIsInductionPlaying(true);
  };

  const handleInductionVideoError = useCallback(() => {
    setInductionVideoFailed(true);
  }, []);

  const runSingleExport = useCallback(async (format: ExportReportFormat) => {
    setExportNotice(null);
    setIsExporting(true);

    try {
      const path = await save({
        title: format === 'csv' ? '导出单次报告（CSV）' : '导出单次报告（JSON）',
        defaultPath: suggestReportFileName({ kind: 'single', format, subjectId: state.subjectId }),
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });

      if (typeof path !== 'string') {
        return;
      }

      const result = await exportEffectReport(buildSingleReportPayload({
        baselineRecordId: state.baselineRecordId, postRecordId: state.postRecordId, path, format,
      }));
      setExportNotice({ severity: 'success', text: `单次报告已导出：${result.path}` });
    } catch (error) {
      setExportNotice({ severity: 'error', text: describeFriendlyError(error, '导出单次报告') });
    } finally {
      setIsExporting(false);
    }
  }, [state.baselineRecordId, state.postRecordId, state.subjectId]);

  const runBatchExport = async () => {
    setExportNotice(null);
    setIsExporting(true);

    try {
      const path = await save({
        title: '批量汇总导出（所有被试最近一次评价）',
        defaultPath: suggestReportFileName({ kind: 'batch' }),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });

      if (typeof path !== 'string') {
        return;
      }

      const result = await exportEffectReport(buildBatchReportPayload({ path }));
      setExportNotice({ severity: 'success', text: `批量汇总已导出：${result.path}` });
    } catch (error) {
      setExportNotice({ severity: 'error', text: describeFriendlyError(error, '导出批量汇总') });
    } finally {
      setIsExporting(false);
    }
  };

  // R7, 大纲 6.3 步骤 5: the cross-condition comparison document (both legs'
  // trace, per-dimension inputs, verdict, frozen formula note). The backend
  // re-pairs the two legs from the wizard's subject+emotion at export time.
  const runComparisonExport = useCallback(async (format: ExportReportFormat) => {
    setExportNotice(null);
    setIsExporting(true);

    try {
      const path = await save({
        title: format === 'csv' ? '导出跨条件对比报告（CSV）' : '导出跨条件对比报告（JSON）',
        defaultPath: suggestReportFileName({ kind: 'comparison', format, subjectId: state.subjectId }),
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });

      if (typeof path !== 'string') {
        return;
      }

      const result = await exportEffectReport(buildComparisonReportPayload({
        subjectId: state.subjectId, emotion: state.emotion, path, format,
      }));
      setExportNotice({ severity: 'success', text: `跨条件对比报告已导出：${result.path}` });
    } catch (error) {
      setExportNotice({ severity: 'error', text: describeFriendlyError(error, '导出跨条件对比报告') });
    } finally {
      setIsExporting(false);
    }
  }, [state.emotion, state.subjectId]);

  // The result/comparison cards are memoized, so every callback they
  // receive must keep a stable identity across renders.
  const handleExportSingleJson = useCallback(() => void runSingleExport('json'), [runSingleExport]);
  const handleExportSingleCsv = useCallback(() => void runSingleExport('csv'), [runSingleExport]);
  const handleExportComparisonJson = useCallback(() => void runComparisonExport('json'), [runComparisonExport]);
  const handleExportComparisonCsv = useCallback(() => void runComparisonExport('csv'), [runComparisonExport]);
  const handleRetrySummary = useCallback(() => void flow.loadSummary(), [flow.loadSummary]);
  const handleRetryComparison = useCallback(() => void flow.loadConditionComparison(), [flow.loadConditionComparison]);

  // Pipeline view-model: recomputed only when the flow state (or the result
  // summary's existence) changes — wall-clock ticks keep the same node
  // objects, letting the memoized cards bail out.
  const pipelineNodes = useMemo(
    () => deriveEffectPipelineNodes(state, { hasResultSummary: flow.summary !== null }),
    [state, flow.summary],
  );

  const toggleNode = useCallback((step: EffectFlowStep) => {
    setExpandedDoneSteps((current) => {
      const next = new Set(current);
      if (next.has(step)) {
        next.delete(step);
      } else {
        next.add(step);
      }
      return next;
    });
  }, []);

  const configSummary = (
    <div className={styles.configSummary}>
      <span className={styles.configChip}>被试 {state.subjectId.trim() || '未填写'}</span>
      <span className={styles.configChip}>目标情绪 {emotionLabel}</span>
      <span className={styles.configChip}>{methodLabel}</span>
      <span className={styles.configChip}>{labelForCondition(state.condition)}</span>
    </div>
  );

  const eegUnavailableHint = <EegUnavailableHint />;

  // Library summary for the context strip: the pool loads only while the
  // induction node is active, so earlier steps advertise that instead.
  const librarySummary = state.step < 1
    ? '素材库：情绪诱发时加载'
    : flow.isInductionPoolLoading
      ? '素材库：加载中…'
      : flow.inductionStatus.kind === 'ready'
        ? '素材库：已就绪'
        : state.step === 1
          ? '素材库：不可用'
          : '素材库：未校验';

  /** Shared invocation for nodes 2/4 — the two phases differ only in `phase`. */
  const renderScalePanel = (phase: 'baseline' | 'post') => (
    <ScaleStepPanel
      flow={flow} phase={phase} configSummary={configSummary} skippedCopy={skippedCopy}
      isDialogOpen={isScaleDialogOpen}
      onOpenDialog={() => setIsScaleDialogOpen(true)} onCloseDialog={() => setIsScaleDialogOpen(false)}
    />
  );

  /** The current node's interactive area — one panel per step, built only
   *  for the active node so the other cards never rebuild it. */
  const renderCurrentPanel = (step: EffectFlowStep): ReactNode => {
    switch (step) {
      case 0:
        return <SetupStepPanel flow={flow} />;
      case 1:
        return (
          <InductionStepPanel
            flow={flow} configSummary={configSummary} eegUnavailableHint={eegUnavailableHint}
            isInductionPlaying={isInductionPlaying} inductionVideoFailed={inductionVideoFailed}
            inductionRetryCount={inductionRetryCount} onBeginInduction={handleBeginInduction}
            onResetFlow={handleResetFlow} onRetryInductionVideo={handleRetryInductionVideo}
            onVideoError={handleInductionVideoError}
          />
        );
      case 2:
        return renderScalePanel('baseline');
      case 3:
        return (
          <ConditionStepPanel
            flow={flow} finishMode={finishMode} windowNoun={windowNoun} isNaturalRecovery={isNaturalRecovery}
            methodLabel={methodLabel} configSummary={configSummary} skippedCopy={skippedCopy}
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
              measuredBasisNote={measuredBasisNote} skippedCopy={skippedCopy}
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

  const renderDoneDetails = (node: EffectPipelineNode): ReactNode => (
    <PipelineDoneDetails
      node={node} state={state} emotionLabel={emotionLabel}
      methodLabel={methodLabel} skippedCopy={skippedCopy}
    />
  );

  return (
    <Box className={styles.workspace} aria-label="情绪调控效果评价">
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <div>
            <div className={styles.eyebrow}>效果评价闭环</div>
            <h1 className={styles.title}>情绪调控效果评价</h1>
            <p className={styles.description}>
              六个节点同屏推进：按 情绪诱发 → 诱发后量表 → 条件执行 → 条件后量表 的流程采集同一被试的两次量表，
              自动计算各维度改善率并与 10% 阈值比较；基线条件（自然恢复）与调控条件各完成一次后可跨条件对比。
            </p>
          </div>
          <div className={styles.headerActions}>
            <Button variant="outlined" disabled={isExporting} onClick={() => void runBatchExport()}>
              批量汇总导出（CSV）
            </Button>
          </div>
        </div>

        {/* Experiment context strip: run facts + EEG association badge, so the
            trial-run state is visible before any node is entered. */}
        <div className={styles.contextBar} aria-label="实验上下文">
          <span className={styles.configChip}>被试 {state.subjectId.trim() || '未填写'}</span>
          <span className={styles.configChip}>目标情绪 {emotionLabel}</span>
          <span className={styles.configChip}>{methodLabel}</span>
          <span className={styles.configChip}>{labelForCondition(state.condition)}</span>
          <span className={styles.configChip}>时长 {state.durationMinutes} 分钟</span>
          <span className={styles.configChip}>{librarySummary}</span>
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

      {activeTab === 'wizard' ? (
        <>
          <div className={styles.pipeline} aria-label="评价管线总览">
            {pipelineNodes.map((node) => {
              const isCurrent = node.status === 'current';
              const isDone = node.status === 'done';
              const isExpanded = isCurrent || (isDone && expandedDoneSteps.has(node.step));

              return (
                <EffectPipelineCard key={node.step} node={node} isExpanded={isExpanded} onToggle={toggleNode}>
                  {/* Collapsed/pending cards receive no children so the memo
                      comparison bails them out of wall-clock re-renders. */}
                  {isCurrent
                    ? renderCurrentPanel(node.step)
                    : isDone && expandedDoneSteps.has(node.step)
                      ? renderDoneDetails(node)
                      : undefined}
                </EffectPipelineCard>
              );
            })}
          </div>

          {state.step > 0 ? (
            <div className={`${styles.actionsRow} ${styles.actionsRowStart}`}>
              <button type="button" className={styles.secondaryAction} onClick={handleResetFlow}>
                重置流程
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <EffectHistoryPanel />
      )}

      {confirmDialogElement}
    </Box>
  );
}
