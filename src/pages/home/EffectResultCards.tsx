import { memo } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import type {
  ConditionComparisonLegView,
  ConditionEffectComparisonView,
  RegulationEffectSummaryView,
} from '../../mentalScale/scaleRecordsApi';
import {
  CONDITION_COMPARISON_FORMULA_NOTE,
  formatImprovementRate,
  labelForDimension,
  type EffectVerdictCopy,
} from './effectEvaluationFlow';
import type { EffectChartOption } from './effectResultChartOption';
import { formatRunTimestamp } from './effectHistoryView';
import { EffectResultChart } from './EffectResultChartView';
import styles from './EffectEvaluation.module.css';

/**
 * Result-step presentation components (VerdictBanner, ScoreCell, PillGroup,
 * ResultCard, ConditionComparisonCard) moved verbatim out of the wizard page
 * so the pipeline page stays under the 500-line budget. Props are unchanged;
 * both cards stay memoized — every prop must remain referentially stable
 * between data changes.
 */

/** Sign-tints the headline metric value green (improved) / brand red
 *  (worse) - presentation only, mirroring the table's rate cells. */
const metricValueClass = (rate: number | null) =>
  `${styles.metricHeroValue}${rate !== null ? ` ${rate >= 0 ? styles.isPositive : styles.isNegative}` : ''}`;

/** Clamps a scale score into the 0-100% width of the mini before/after
 *  bars (the same axis range the result charts use). */
const scoreBarPercent = (score: number) => Math.min(100, Math.max(0, Math.round(score)));

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
        {/* Family glyphs (taste-skill §3.C: no hand-rolled icon paths); the
            .heroIcon svg 22px rule still sizes these. */}
        {isPass ? <CheckRoundedIcon /> : <ErrorOutlineRoundedIcon />}
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
          style={{ transform: `scaleX(${scoreBarPercent(value) / 100})` }}
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

/** Shared pill-radio row; the setup panel reuses it for its option groups. */
export function PillGroup<T extends string>({
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
  /** Post-column label: 调控后 for the regulation leg, 静息后 for the
   *  natural-recovery leg (nothing was regulated on that run). */
  postLabel?: string;
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
export const ResultCard = memo(function ResultCard({
  chartOption,
  eegSessionId,
  isLoadingSummary,
  isExporting,
  measuredBasisNote,
  postLabel = '调控后',
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
                      <th scope="col">{postLabel}</th>
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
export const ConditionComparisonCard = memo(function ConditionComparisonCard({
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
            本次运行的数据已保存；重置流程后选择另一条件再完整评价一次即可补齐。
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
                      <th scope="col">基线条件 · 条件后</th>
                      <th scope="col">调控条件 · 条件后</th>
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
