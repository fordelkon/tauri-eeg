import { useCallback, useEffect, memo, useMemo, useRef, useState, type ReactNode } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { save } from '@tauri-apps/plugin-dialog';
import type { EChartsType } from 'echarts/core';
import { getParadigmSessionStatus } from '../../eeg/paradigm/paradigmSessionStatus';
import MentalScaleDialog from '../../mentalScale/MentalScaleDialog';
import {
  exportEffectReport,
  type ConditionComparisonLegView,
  type ConditionEffectComparisonView,
  type RegulationEffectSummaryView,
} from '../../mentalScale/scaleRecordsApi';
import { useConfirmDialog } from '../../ui/useConfirmDialog';
import { describeFriendlyError } from '../../ui/friendlyError';
import { toPlayableVideoUrl } from '../../video/videoRegulationCatalog';
import {
  buildConditionComparisonVerdictCopy,
  buildEffectVerdictCopy,
  CONDITION_COMPARISON_FORMULA_NOTE,
  describeMeasuredBasis,
  describeRegulationSkipped,
  EFFECT_CONDITION_OPTIONS,
  EFFECT_EMOTION_OPTIONS,
  EFFECT_FLOW_STEPS,
  EFFECT_METHOD_OPTIONS,
  type EffectVerdictCopy,
  formatCountdown,
  formatImprovementRate,
  labelForCondition,
  labelForDimension,
  regulationDurationMs,
  regulationFinishModeFromRemaining,
} from './effectEvaluationFlow';
import {
  buildBatchReportPayload,
  buildComparisonReportPayload,
  buildSingleReportPayload,
  suggestReportFileName,
  type ExportReportFormat,
} from './effectReportExport';
import { formatRunTimestamp } from './effectHistoryView';
import {
  buildConditionComparisonChartOption,
  buildEffectChartOption,
  type EffectChartOption,
} from './effectResultChartOption';
import EffectHistoryPanel from './EffectHistoryPanel';
import { useEffectEvaluationFlow } from './useEffectEvaluationFlow';
import styles from './EffectEvaluation.module.css';

const DURATION_MINUTE_OPTIONS = [1, 3, 5, 10, 15, 30] as const;

/** Sign-tints the headline metric value green (improved) / brand red
 *  (worse) - presentation only, mirroring the table's rate cells. */
const metricValueClass = (rate: number | null) =>
  `${styles.metricHeroValue}${rate !== null ? ` ${rate >= 0 ? styles.isPositive : styles.isNegative}` : ''}`;

/** Clamps a scale score into the 0-100% width of the mini before/after
 *  bars (the same axis range the result charts use). */
const scoreBarPercent = (score: number) => Math.min(100, Math.max(0, Math.round(score)));

type PageTab = 'wizard' | 'history';

type ExportNotice = {
  severity: 'success' | 'error';
  text: string;
};

/** Bar chart for the baseline/post comparison; echarts loads on demand. */
function EffectResultChart({
  option,
  ariaLabel,
}: {
  option: Record<string, unknown>;
  ariaLabel?: string;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<EChartsType | null>(null);
  const [isChartReady, setIsChartReady] = useState(false);

  useEffect(() => {
    if (!chartRef.current) {
      return undefined;
    }

    const host = chartRef.current;
    let cancelled = false;
    let frameHandle: number | null = null;
    let resizeCleanup: (() => void) | undefined;

    void import('./effectResultChart').then(({ default: echarts }) => {
      if (cancelled || !chartRef.current) {
        return;
      }

      const chart = echarts.init(chartRef.current);
      chartInstanceRef.current = chart;
      setIsChartReady(true);

      // ResizeObserver on the chart host with rAF-throttled resize(): unlike
      // a window resize listener it also catches layout-driven width changes
      // (e.g. a collapsible sidebar) without calling resize() per event.
      const observer = new ResizeObserver(() => {
        if (frameHandle !== null || cancelled) {
          return;
        }
        frameHandle = window.requestAnimationFrame(() => {
          frameHandle = null;
          if (!cancelled) {
            chart.resize();
          }
        });
      });
      observer.observe(host);
      resizeCleanup = () => {
        observer.disconnect();
        if (frameHandle !== null) {
          window.cancelAnimationFrame(frameHandle);
          frameHandle = null;
        }
      };
    });

    return () => {
      cancelled = true;
      resizeCleanup?.();
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isChartReady) {
      return;
    }

    chartInstanceRef.current?.setOption(option, true);
  }, [isChartReady, option]);

  return (
    <div className={styles.chartWrap}>
      {/* ECharts hosts on the inner box: zrender sizes the canvas from
          clientWidth/Height and starts it in the content box, so the padded,
          bordered frame must sit outside the chart element itself. */}
      <div
        ref={chartRef}
        className={styles.chartCanvas}
        role="img"
        aria-label={ariaLabel ?? '基线与调控后量表得分对比图'}
      />
    </div>
  );
}

/** Verdict hero for the result & comparison cards: a severity-tinted banner
 *  with an icon disc, so the finish reads as a completed state instead of
 *  an incidental message. The copy comes straight from the pure builders -
 *  presentation only, the text is not modified here. */
function VerdictBanner({
  copy,
}: {
  copy: EffectVerdictCopy;
}) {
  const isPass = copy.severity === 'success';

  return (
    <div
      className={`${styles.resultHero} ${isPass ? styles.heroPass : styles.heroWarn}`}
      role="status"
    >
      <span className={styles.heroIcon} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor" focusable="false">
          {isPass ? (
            <path d="M9.55 17.57 4.88 12.9l1.41-1.41 3.26 3.25 8.16-8.16 1.41 1.42z" />
          ) : (
            <path d="M11 7h2v8h-2zm0 10h2v2h-2z" />
          )}
        </svg>
      </span>
      <p className={styles.heroCopy}>
        <strong className={styles.heroTitle}>{copy.title}</strong>
        <span className={styles.heroDetail}>{copy.detail}</span>
      </p>
    </div>
  );
}

/** One score cell for the dimension tables: the number plus a mini 0-100
 *  bar so 基线 vs 调控后 compare at a glance down the column. */
function ScoreCell({ value, barClass }: { value: number; barClass?: string }) {
  return (
    <span className={styles.scoreCell}>
      <span className={styles.scoreNum}>{Math.round(value)}</span>
      <span className={styles.scoreTrack} aria-hidden="true">
        <span
          className={`${styles.scoreBar}${barClass ? ` ${barClass}` : ''}`}
          style={{ width: `${scoreBarPercent(value)}%` }}
        />
      </span>
    </span>
  );
}

type PillGroupProps<T extends string> = {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  selectedValue: T;
  onSelect: (value: T) => void;
};

function PillGroup<T extends string>({
  label,
  options,
  selectedValue,
  onSelect,
}: PillGroupProps<T>) {
  return (
    <div className={styles.pillRow} role="radiogroup" aria-label={label}>
      <span className={styles.pillLabel}>{label}</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={selectedValue === option.value}
          className={`${styles.pillRadio} ${selectedValue === option.value ? styles.isSelected : ''}`}
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type ResultCardProps = {
  chartOption: EffectChartOption | null;
  eegSessionId: string | null;
  isLoadingSummary: boolean;
  isExporting: boolean;
  measuredBasisNote: string | null;
  onExportCsv: () => void;
  onExportJson: () => void;
  onRetry: () => void;
  skippedCopy: string | null;
  summary: RegulationEffectSummaryView | null;
  summaryError: string | null;
  verdictCopy: EffectVerdictCopy | null;
};

/** Result-step card for the finished run: verdict hero, improvement
 *  metrics, the before/after chart and the per-dimension table. Memoized —
 *  every prop must stay referentially stable between data changes. */
const ResultCard = memo(function ResultCard({
  chartOption,
  eegSessionId,
  isLoadingSummary,
  isExporting,
  measuredBasisNote,
  onExportCsv,
  onExportJson,
  onRetry,
  skippedCopy,
  summary,
  summaryError,
  verdictCopy,
}: ResultCardProps) {
  return (
    <section
      className={`${styles.panel} ${styles.resultPanel}`}
      aria-label="结果评价"
    >
      <h2 className={styles.panelTitle}>结果评价</h2>

      {isLoadingSummary ? (
        <p className={`${styles.panelHint} ${styles.loadingHint}`}>正在计算改善率…</p>
      ) : null}

      {summaryError ? (
        <>
          <Alert severity="warning">{summaryError}</Alert>
          <div className={styles.actionsRow}>
            <Button variant="outlined" onClick={onRetry}>
              重试计算
            </Button>
          </div>
        </>
      ) : null}

      {summary && verdictCopy && !isLoadingSummary ? (
        <>
          <VerdictBanner copy={verdictCopy} />

          {skippedCopy ? <Alert severity="warning">{skippedCopy}</Alert> : null}

          <div className={styles.metricGrid}>
            <div className={styles.metricHero}>
              <span className={styles.metricLabel}>平均改善率</span>
              <span className={metricValueClass(summary.meanImprovementRate)}>
                {summary.meanImprovementRate === null ? null : (
                  <span
                    className={`${styles.deltaArrow} ${
                      summary.meanImprovementRate >= 0
                        ? styles.deltaArrowUp
                        : styles.deltaArrowDown
                    }`}
                    aria-hidden="true"
                  />
                )}
                {summary.meanImprovementRate === null
                  ? '-'
                  : formatImprovementRate(summary.meanImprovementRate)}
              </span>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>达标阈值</span>
              <span className={styles.metricValue}>10%</span>
            </div>
            {/* R4/F1: only dimensions marked as measured on both sides enter
                the mean, so this count is the honest comparison basis. */}
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>实际纳入对比的维度数</span>
              <span className={styles.metricValue}>{summary.dimensions.length}</span>
            </div>
          </div>

          {measuredBasisNote ? (
            <p className={styles.noteCallout} role="note">{measuredBasisNote}</p>
          ) : null}

          {eegSessionId ? (
            <div className={styles.configSummary}>
              <span className={styles.configChip} title={eegSessionId}>
                关联 EEG 会话 {`${eegSessionId.slice(0, 8)}…`}
              </span>
            </div>
          ) : null}

          {chartOption ? (
            <>
              <EffectResultChart option={chartOption} />
              <div className={styles.tableFrame}>
                <table className={styles.dimensionTable}>
                  <thead>
                    <tr>
                      <th scope="col">维度</th>
                      <th scope="col">基线</th>
                      <th scope="col">调控后</th>
                      <th scope="col">改善率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.dimensions.map((dimension) => (
                      <tr key={dimension.dimension}>
                        <td>{labelForDimension(dimension.dimension)}</td>
                        <td><ScoreCell value={dimension.baseline} /></td>
                        <td><ScoreCell
                          value={dimension.post}
                          barClass={dimension.improvementRate >= 0 ? styles.barUp : styles.barDown}
                        /></td>
                        <td className={dimension.improvementRate >= 0
                          ? `${styles.rateCell} ${styles.isPositive}`
                          : `${styles.rateCell} ${styles.isNegative}`}
                        >
                          {formatImprovementRate(dimension.improvementRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          <div className={`${styles.actionsRow} ${styles.resultActions}`}>
            <Button
              variant="outlined"
              disabled={isExporting}
              onClick={onExportJson}
            >
              导出单次报告（JSON）
            </Button>
            <Button
              variant="outlined"
              disabled={isExporting}
              onClick={onExportCsv}
            >
              导出单次报告（CSV）
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
});

type ConditionComparisonCardProps = {
  chartOption: EffectChartOption | null;
  comparisonError: string | null;
  conditionComparison: ConditionEffectComparisonView | null;
  isLoadingComparison: boolean;
  isExporting: boolean;
  measuredBasisNote: string | null;
  onExportCsv: () => void;
  onExportJson: () => void;
  onRetry: () => void;
  verdictCopy: EffectVerdictCopy | null;
};

/** R6, 大纲 6.2: regulation vs natural-recovery runs of this subject+emotion,
 *  rendered as one card. Memoized like ResultCard — every prop must stay
 *  referentially stable between data changes. */
const ConditionComparisonCard = memo(function ConditionComparisonCard({
  chartOption,
  comparisonError,
  conditionComparison,
  isLoadingComparison,
  isExporting,
  measuredBasisNote,
  onExportCsv,
  onExportJson,
  onRetry,
  verdictCopy,
}: ConditionComparisonCardProps) {
  /** R7, 大纲 6.3 步骤 5: one leg's record trace chip (id + timestamp).
   *  The leading swatch matches the comparison chart's series color so the
   *  on-screen pairing stays legible next to the chart. */
  const renderComparisonLegTrace = (
    label: string,
    leg: ConditionComparisonLegView,
    tone: 'baseline' | 'regulation',
  ) => (
    <span
      className={`${styles.legTrace} ${
        tone === 'baseline' ? styles.legTraceBaseline : styles.legTraceRegulation
      }`}
      title={`post 记录 ${leg.postRecordId}；基线记录 ${leg.baselineRecordId}；量表 ${leg.scaleId}`}
    >
      {label} post {`${leg.postRecordId.slice(0, 8)}…`} · {formatRunTimestamp(leg.postCreatedAt)}
    </span>
  );

  return (
    <section
      className={`${styles.panel} ${styles.resultPanel}`}
      aria-label="跨条件对比"
    >
      <div className={styles.stepHeader}>
        <h2 className={styles.panelTitle}>跨条件对比（基线条件 vs 调控条件）</h2>
        <p className={styles.panelHint}>
          同被试同情绪分别完成 基线条件（自然恢复） 与 调控条件 各一次完整评价后，
          此处自动对比两条件的条件后得分。
        </p>
      </div>

      {isLoadingComparison ? (
        <p className={`${styles.panelHint} ${styles.loadingHint}`}>正在计算跨条件对比…</p>
      ) : null}

      {comparisonError ? (
        <>
          <Alert severity="info">
            {comparisonError}
            <br />
            需完成基线条件（自然恢复）与调控条件各一次完整评价，本卡才会展示跨条件对比。
          </Alert>
          <div className={styles.actionsRow}>
            <Button
              variant="outlined"
              onClick={onRetry}
            >
              重试计算
            </Button>
          </div>
        </>
      ) : null}

      {conditionComparison && verdictCopy && !isLoadingComparison ? (
        <>
          <VerdictBanner copy={verdictCopy} />

          <div className={styles.metricGrid}>
            <div className={styles.metricHero}>
              <span className={styles.metricLabel}>跨条件平均改善率</span>
              <span className={metricValueClass(conditionComparison.meanImprovementRate)}>
                {conditionComparison.meanImprovementRate === null ? null : (
                  <span
                    className={`${styles.deltaArrow} ${
                      conditionComparison.meanImprovementRate >= 0
                        ? styles.deltaArrowUp
                        : styles.deltaArrowDown
                    }`}
                    aria-hidden="true"
                  />
                )}
                {conditionComparison.meanImprovementRate === null
                  ? '-'
                  : formatImprovementRate(conditionComparison.meanImprovementRate)}
              </span>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>达标阈值</span>
              <span className={styles.metricValue}>10%</span>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>实际纳入对比的维度数</span>
              <span className={styles.metricValue}>{conditionComparison.dimensions.length}</span>
            </div>
          </div>

          <p className={styles.noteCallout} role="note">{CONDITION_COMPARISON_FORMULA_NOTE}</p>

          {/* R7, 大纲 6.3 步骤 5: both legs' post-record ids and timestamps
              stay visible on screen so the pairing is auditable without the
              export document (the full ids ride on the card tooltips). */}
          <div className={styles.legTraceGrid}>
            {renderComparisonLegTrace('基线条件', conditionComparison.naturalRecoveryLeg, 'baseline')}
            {renderComparisonLegTrace('调控条件', conditionComparison.regulationLeg, 'regulation')}
          </div>

          {measuredBasisNote ? (
            <p className={styles.noteCallout} role="note">{measuredBasisNote}</p>
          ) : null}

          {chartOption ? (
            <>
              <EffectResultChart
                option={chartOption}
                ariaLabel="基线条件与调控条件条件后得分对比图"
              />
              <div className={styles.tableFrame}>
                <table className={styles.dimensionTable}>
                  <thead>
                    <tr>
                      <th scope="col">维度</th>
                      <th scope="col">基线条件 post</th>
                      <th scope="col">调控条件 post</th>
                      <th scope="col">改善率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conditionComparison.dimensions.map((dimension) => (
                      <tr key={dimension.dimension}>
                        <td>{labelForDimension(dimension.dimension)}</td>
                        <td><ScoreCell value={dimension.naturalRecoveryPost} /></td>
                        <td><ScoreCell
                          value={dimension.regulationPost}
                          barClass={dimension.improvementRate >= 0 ? styles.barUp : styles.barDown}
                        /></td>
                        <td className={dimension.improvementRate >= 0
                          ? `${styles.rateCell} ${styles.isPositive}`
                          : `${styles.rateCell} ${styles.isNegative}`}
                        >
                          {formatImprovementRate(dimension.improvementRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {/* R7, 大纲 6.3 步骤 5: the comparison's calculation process leaves
              the page and lands in a file (JSON: full legs + formula; CSV:
              per-dimension rows, single-report style). */}
          <div className={`${styles.actionsRow} ${styles.resultActions}`}>
            <Button
              variant="outlined"
              disabled={isExporting}
              onClick={onExportJson}
            >
              导出跨条件对比报告（JSON）
            </Button>
            <Button
              variant="outlined"
              disabled={isExporting}
              onClick={onExportCsv}
            >
              导出跨条件对比报告（CSV）
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
});

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

  const emotionLabel = EFFECT_EMOTION_OPTIONS.find(
    (option) => option.value === state.emotion,
  )?.label ?? state.emotion;
  const methodLabel = EFFECT_METHOD_OPTIONS.find(
    (option) => option.value === state.method,
  )?.label ?? state.method;
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
      flow.resetFlow();
    }
  };

  // Strong duration constraint (R3): the countdown is a hard floor - the
  // normal finish unlocks only at zero, earlier exits go through the
  // double-confirmed skip which records the marker with the run. The same
  // constraint guards both R6 conditions (regulation jump / in-page rest).
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
    () => (flow.summary && flow.summary.dimensions.length > 0
      ? buildEffectChartOption(flow.summary)
      : null),
    [flow.summary],
  );

  // Cross-condition comparison (R6, 大纲 6.2): verdict, basis note, chart.
  const comparisonVerdictCopy = useMemo(
    () => (flow.conditionComparison
      ? buildConditionComparisonVerdictCopy(flow.conditionComparison)
      : null),
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

  /** Step 1 entry: starts the EEG association, then mounts the player. */
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

  /**
   * R7: remounts the player after a load failure (the retry counter rides on
   * the element key so a fresh <video> re-fetches the file). The alternative
   * exit - reset back to the setup step - is the flow reset below the wizard.
   */
  const handleRetryInductionVideo = () => {
    setInductionVideoFailed(false);
    setInductionRetryCount((count) => count + 1);
    setIsInductionPlaying(true);
  };

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
        baselineRecordId: state.baselineRecordId,
        postRecordId: state.postRecordId,
        path,
        format,
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

  /**
   * R7, 大纲 6.3 步骤 5: the cross-condition comparison document (both legs'
   * trace, per-dimension inputs, verdict, frozen formula note). The backend
   * re-pairs the two legs from the wizard's subject+emotion at export time.
   */
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
        subjectId: state.subjectId,
        emotion: state.emotion,
        path,
        format,
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

  const configSummary = (
    <div className={styles.configSummary}>
      <span className={styles.configChip}>被试 {state.subjectId.trim() || '未填写'}</span>
      <span className={styles.configChip}>目标情绪 {emotionLabel}</span>
      <span className={styles.configChip}>{methodLabel}</span>
      <span className={styles.configChip}>{labelForCondition(state.condition)}</span>
    </div>
  );

  /** EEG association chip shared by the induction, scale-gate and condition steps. */
  const renderEegAssociationChip = () => {
    if (state.eegAssociation === 'not-started') {
      return null;
    }

    return (
      <div className={styles.pillRow}>
        <span
          role="status"
          className={`${styles.eegChip} ${
            state.eegAssociation === 'saved'
              ? styles.eegSaved
              : state.eegAssociation === 'recording'
                ? styles.eegRecording
                : styles.eegUnavailable
          }`}
        >
          {state.eegAssociation === 'saved'
            ? `✓ EEG 记录已保存${state.eegSessionId ? `（会话 ${`${state.eegSessionId.slice(0, 8)}…`}）` : ''}`
            : state.eegAssociation === 'recording'
              ? '● 正在关联 EEG 记录'
              : '! 设备不可用，本次未关联 EEG 记录'}
        </span>
      </div>
    );
  };

  const renderSetupStep = () => (
    <section className={styles.panel} aria-label="选择被试与评价配置">
      <div className={styles.stepHeader}>
        <h2 className={styles.panelTitle}>选择被试</h2>
        <p className={styles.panelHint}>
          被试 ID 会绑定到本轮的诱发后与条件后量表记录，用于配对计算改善率。
        </p>
      </div>

      <div className={styles.fieldGrid}>
        <label className={styles.fieldLabel}>
          <span className={styles.fieldLabelText}>被试 ID</span>
          <input
            className={styles.textInput}
            value={state.subjectId}
            onChange={(event) => flow.updateDraft({ subjectId: event.currentTarget.value })}
            placeholder="例如 subj-001"
            autoComplete="off"
          />
        </label>
        <label className={styles.fieldLabel}>
          <span className={styles.fieldLabelText}>条件时长（分钟）</span>
          <select
            className={styles.selectInput}
            value={state.durationMinutes}
            onChange={(event) => flow.updateDraft({ durationMinutes: Number(event.currentTarget.value) })}
          >
            {DURATION_MINUTE_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>{minutes}</option>
            ))}
          </select>
        </label>
      </div>

      <PillGroup
        label="目标情绪:"
        options={[...EFFECT_EMOTION_OPTIONS]}
        selectedValue={state.emotion}
        onSelect={(value) => flow.updateDraft({ emotion: value })}
      />
      <div className={styles.setupSection}>
        <PillGroup
          label="调控手段（仅调控条件使用）:"
          options={EFFECT_METHOD_OPTIONS.map(({ value, label }) => ({ value, label }))}
          selectedValue={state.method}
          onSelect={(value) => flow.updateDraft({ method: value })}
        />
        <PillGroup
          label="实验条件:"
          options={EFFECT_CONDITION_OPTIONS.map(({ value, label }) => ({ value, label }))}
          selectedValue={state.condition}
          onSelect={(value) => flow.updateDraft({ condition: value })}
        />
        <p className={styles.noteCallout} role="note">
          实验条件说明：基线条件（自然恢复）＝情绪诱发后不施加调控手段，静息自然恢复；
          调控条件＝情绪诱发后施加所选调控手段（音乐/视频）。同被试同情绪完成两种条件各一次后，结果步会给出跨条件对比。
        </p>
      </div>

      {flow.actionError ? <div className={styles.errorBanner} role="alert">{flow.actionError}</div> : null}

      <div className={styles.actionsRow}>
        <Button
          variant="contained"
          disabled={state.subjectId.trim().length === 0}
          onClick={flow.startBaselineMeasurement}
        >
          下一步：情绪诱发
        </Button>
      </div>
    </section>
  );

  const renderInductionStep = () => {
    const status = flow.inductionStatus;

    return (
      <section className={styles.panel} aria-label="情绪诱发">
        <div className={styles.stepHeader}>
          <h2 className={styles.panelTitle}>情绪诱发</h2>
          <p className={styles.panelHint}>
            播放目标情绪的诱发素材（来自 EEG 采集页校验过的 video_paradigm 素材库）；
            开始诱发时在设备可用的情况下自动关联 EEG 记录，素材播放完毕后进入诱发后量表。
          </p>
        </div>
        {configSummary}

        {flow.actionError ? <div className={styles.errorBanner} role="alert">{flow.actionError}</div> : null}

        {flow.isInductionPoolLoading ? (
          <p className={`${styles.panelHint} ${styles.loadingHint}`}>正在加载诱发素材库…</p>
        ) : status.kind === 'blocked' ? (
          <Alert severity="warning">{status.copy}</Alert>
        ) : inductionVideoFailed && status.kind === 'ready' ? (
          <>
            {/* R7: a mid-run file failure (moved/corrupted) must not strand
                the induction step - only onEnded advances, so onError needs
                its own branch with a retry and a way back to the setup step. */}
            <Alert severity="error">
              诱发素材加载失败（文件可能已被移动或损坏），播放已中断。可重试加载；
              若素材库文件已缺失，请先到 EEG 采集页补齐素材库，或重置流程返回设置步。
            </Alert>
            <div className={styles.actionsRow}>
              <Button variant="outlined" onClick={handleRetryInductionVideo}>
                重试加载素材
              </Button>
              <Button variant="outlined" color="warning" onClick={handleResetFlow}>
                重置并返回设置步
              </Button>
            </div>
          </>
        ) : isInductionPlaying && status.kind === 'ready' ? (
          <>
            <video
              key={`${status.entry.videoId}-${inductionRetryCount}`}
              className={styles.inductionVideo}
              src={toPlayableVideoUrl(status.entry.absolutePath, convertFileSrc)}
              controls
              autoPlay
              playsInline
              ref={(node) => {
                if (node) {
                  node.volume = 1;
                }
              }}
              onEnded={() => flow.completeInduction()}
              onError={() => setInductionVideoFailed(true)}
            />
            <p className={styles.panelHint}>
              正在播放诱发素材「{status.entry.fileName}」，播放结束后自动进入诱发后量表。
            </p>
          </>
        ) : status.kind === 'ready' ? (
          <>
            <div className={styles.actionsRow}>
              <Button variant="contained" onClick={handleBeginInduction}>
                播放诱发素材（{status.entry.fileName}）
              </Button>
            </div>
            <p className={styles.panelHint}>
              点击开始后播放素材并计时，同时在设备可用时自动关联本次 EEG 记录。
            </p>
          </>
        ) : null}

        {renderEegAssociationChip()}
      </section>
    );
  };

  const renderScaleStep = (phase: 'baseline' | 'post') => {
    const isBaseline = phase === 'baseline';

    return (
      <section
        className={`${styles.panel} ${styles.panelImmersive}`}
        aria-label={isBaseline ? '诱发后量表' : '条件后量表'}
      >
        <div className={styles.stepHeader}>
          <h2 className={styles.panelTitle}>{isBaseline ? '诱发后量表' : '条件后复测'}</h2>
          <p className={styles.panelHint}>
            {isBaseline
              ? '情绪诱发已完成，请先完成一次心理量表，作为本次条件执行前的评价基线（phase 记为 baseline）。'
              : '条件执行已结束，请用同一份量表再测一次，用于计算各维度改善率。'}
          </p>
        </div>
        {configSummary}

        {!isBaseline && skippedCopy ? <Alert severity="warning">{skippedCopy}</Alert> : null}

        {flow.actionError ? <div className={styles.errorBanner} role="alert">{flow.actionError}</div> : null}

        {!flow.scaleForMethod ? (
          <Alert severity="warning" id={`scale-missing-hint-${phase}`}>
            当前调控手段（{methodLabel}）尚未配置对应量表，无法继续{isBaseline ? '基线' : '复测'}评价。
            请返回设置步更换手段，或联系管理员补齐量表定义。
          </Alert>
        ) : null}

        <div className={styles.actionsRow}>
          <Button
            variant="contained"
            disabled={flow.isSavingScale || !flow.scaleForMethod}
            aria-describedby={!flow.scaleForMethod ? `scale-missing-hint-${phase}` : undefined}
            onClick={() => setIsScaleDialogOpen(true)}
          >
            {flow.isSavingScale ? '正在保存量表…' : `打开${isBaseline ? '诱发后' : '复测'}量表`}
          </Button>
        </div>

        {renderEegAssociationChip()}

        {isScaleDialogOpen && flow.scaleForMethod ? (
          <MentalScaleDialog
            key={`scale-${phase}-${state.method}`}
            scale={flow.scaleForMethod}
            onComplete={(answers) => {
              setIsScaleDialogOpen(false);
              void flow.completeScaleMeasurement(phase, answers);
            }}
            onClose={() => setIsScaleDialogOpen(false)}
          />
        ) : null}
      </section>
    );
  };

  /**
   * Step 3, condition branch (R6): the regulation condition jumps to the
   * method's page under the wizard's wall-clock window; the natural-recovery
   * (基线) condition runs its rest countdown inside this page only - no
   * navigation, no regulation-page session context.
   */
  const renderConditionStep = () => (
    <section className={`${styles.panel} ${styles.panelImmersive}`} aria-label="条件执行">
      <div className={styles.stepHeader}>
        <h2 className={styles.panelTitle}>
          {isNaturalRecovery ? '条件执行：自然恢复（基线条件）' : '执行调控'}
        </h2>
        <p className={styles.panelHint}>
          {isNaturalRecovery
            ? '诱发后不施加任何调控手段：请让被试保持静息放松（减少眨眼与头动），按设定时长自然恢复，倒计时结束后进入复测。本步骤全程停留在本页。'
            : `前往${methodLabel}页面进行调控，本页按设定的时长计时；结束后回到本页继续复测。`}
        </p>
      </div>

      <div className={styles.configSummary}>
        <span className={styles.configChip}>被试 {state.subjectId.trim() || '未填写'}</span>
        <span className={styles.configChip}>目标情绪 {emotionLabel}</span>
        <span className={styles.configChip}>{methodLabel}</span>
        <span className={styles.configChip}>{labelForCondition(state.condition)}</span>
        <span className={styles.configChip}>时长 {state.durationMinutes} 分钟</span>
        {state.eegSessionId ? (
          <span className={styles.configChip}>EEG 会话 {`${state.eegSessionId.slice(0, 8)}…`}</span>
        ) : null}
      </div>

      {state.regulationStartedAtMs === null ? (
        <Box className={styles.countdownWrap}>
          <p className={styles.panelHint}>
            点击开始后计时，并在设备可用时自动关联本次 EEG 记录。
          </p>
          <Button variant="contained" onClick={flow.beginRegulation}>
            {isNaturalRecovery ? '开始静息' : '开始调控'}
          </Button>
        </Box>
      ) : (
        <>
          <div className={styles.countdownWrap}>
            <span
              role="status"
              className={`${styles.statusPill} ${flow.remainingSeconds === 0 ? styles.statusDone : styles.statusActive}`}
            >
              {flow.remainingSeconds === 0 ? `✓ ${windowNoun}时长已达成` : `● ${windowNoun}计时中`}
            </span>
            <span
              className={`${styles.countdownValue} ${flow.remainingSeconds === 0 ? styles.countdownDone : ''}`}
              aria-label={`剩余时间 ${formatCountdown(flow.remainingSeconds ?? 0)}`}
            >
              {formatCountdown(flow.remainingSeconds ?? 0)}
            </span>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-label={`${windowNoun}计时进度`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={regulationProgressPercent}
            >
              <div className={styles.progressBar} style={{ width: `${regulationProgressPercent}%` }} />
            </div>
            <p className={styles.panelHint} id="regulation-countdown-hint">
              {flow.remainingSeconds === 0
                ? `${windowNoun}时长已达成，可结束${windowNoun}进入复测。`
                : `未达最短时长：还剩 ${formatCountdown(flow.remainingSeconds ?? 0)}。计时结束后才能进入复测；确有特殊情况可跳过剩余时长（二次确认后记录标记）。`}
            </p>
          </div>

          {skippedCopy ? <Alert severity="warning">{skippedCopy}</Alert> : null}

          {renderEegAssociationChip()}

          <div className={styles.actionsRow}>
            {isNaturalRecovery ? null : (
              <Button variant="outlined" onClick={flow.openRegulationPage}>
                前往{methodLabel}
              </Button>
            )}
            {finishMode.mode === 'requires-skip' ? (
              <Button variant="outlined" color="error" onClick={handleSkipRemaining}>
                跳过剩余时长…
              </Button>
            ) : null}
            <Button
              variant="contained"
              disabled={finishMode.mode !== 'finish'}
              aria-describedby={finishMode.mode !== 'finish' ? 'regulation-countdown-hint' : undefined}
              onClick={handleFinishRegulation}
            >
              {isNaturalRecovery ? '结束静息，进行复测' : '结束调控，进行复测'}
            </Button>
          </div>
        </>
      )}
    </section>
  );

  const regulationProgressPercent = Math.min(100, Math.max(0,
    100 - ((flow.remainingSeconds ?? 0) * 1000 / regulationDurationMs(state)) * 100,
  ));

  // Steps 2-4 run immersive: the full stepper collapses into one fixed-height
  // progress strip so the scale gate and the countdown stage keep every pixel
  // of vertical space the tall stepper card was taking. 0/1/5 keep the stepper.
  const isImmersiveStep = state.step >= 2 && state.step <= 4;

  // Only the active step's subtree is constructed per render: the page
  // re-renders on wall-clock ticks during the condition step, so the
  // non-active steps must not be rebuilt alongside it.
  const renderActiveStep = (): ReactNode => {
    switch (state.step) {
      case 0:
        return renderSetupStep();
      case 1:
        return renderInductionStep();
      case 2:
        return renderScaleStep('baseline');
      case 3:
        return renderConditionStep();
      case 4:
        return renderScaleStep('post');
      case 5:
        return (
          <div className={styles.resultStep}>
            <ResultCard
              chartOption={chartOption}
              eegSessionId={state.eegSessionId}
              isLoadingSummary={flow.isLoadingSummary}
              isExporting={isExporting}
              measuredBasisNote={measuredBasisNote}
              onExportCsv={handleExportSingleCsv}
              onExportJson={handleExportSingleJson}
              onRetry={handleRetrySummary}
              skippedCopy={skippedCopy}
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
            <p className={styles.description}>
              按 情绪诱发 → 诱发后量表 → 条件执行 → 条件后量表 的流程采集同一被试的两次量表，
              自动计算各维度改善率并与 10% 阈值比较；基线条件（自然恢复）与调控条件各完成一次后可跨条件对比。
            </p>
          </div>
          <div className={styles.headerActions}>
            <Button
              variant="outlined"
              disabled={isExporting}
              onClick={() => void runBatchExport()}
            >
              批量汇总导出（CSV）
            </Button>
          </div>
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
          {isImmersiveStep ? (
            /* Fixed-height one-line progress strip - the exact same element
               across steps 2/3/4 (fixed 40px box, same sticky slot), so the
               layout above the content never shifts when the flow advances.
               Left: current step; right: a 6-segment tracker whose active
               segment widens to carry the eye. */
            <div
              className={styles.miniProgress}
              role="status"
              aria-label={`第 ${state.step + 1} 步，共 ${EFFECT_FLOW_STEPS.length} 步：${EFFECT_FLOW_STEPS[state.step]}`}
            >
              <span className={styles.miniProgressLabel}>
                第 {state.step + 1} 步 · {EFFECT_FLOW_STEPS[state.step]}
              </span>
              <span className={styles.srOnly}>
                第 {state.step + 1} 步，共 {EFFECT_FLOW_STEPS.length} 步：{EFFECT_FLOW_STEPS[state.step]}
              </span>
              <span className={styles.miniProgressTrack} aria-hidden="true">
                {EFFECT_FLOW_STEPS.map((label, index) => (
                  <span
                    key={label}
                    title={label}
                    className={`${styles.miniProgressSeg} ${
                      index < state.step
                        ? styles.miniProgressSegDone
                        : index === state.step
                          ? styles.miniProgressSegActive
                          : styles.miniProgressSegPending
                    }`}
                  />
                ))}
              </span>
            </div>
          ) : (
            <Stepper activeStep={state.step} alternativeLabel className={styles.stepper}>
              {EFFECT_FLOW_STEPS.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>
          )}

          {renderActiveStep()}

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
