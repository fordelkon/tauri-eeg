import type {
  ConditionEffectComparisonView,
  RegulationEffectSummaryView,
} from '../../mentalScale/scaleRecordsApi';
import { labelForDimension } from './effectEvaluationFlow';

/**
 * Pure builder for the effect-result bar chart option (基线 vs 调控后 per
 * dimension). Deliberately echarts-free: it returns a plain object so tests
 * can assert the shape in the node environment, mirroring how the radar
 * chart keeps its registration module separate from its data.
 */

export type EffectChartOption = Record<string, unknown>;

const BASELINE_COLOR = '#8a93a6';
/** Muted brick red: keeps the regulation leg clearly "after/warm" against
 *  the baseline gray-blue without the full-saturation brand red, which
 *  was the page's one loud chart color. */
const POST_COLOR = '#c0524c';

/** Honors prefers-reduced-motion for the chart's entry animation. */
export function chartAnimationDuration(): number {
  try {
    const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (query?.matches) {
      return 0;
    }
  } catch {
    // Non-DOM test environments fall through to the animated default.
  }
  return 520;
}

type DimensionPoint = {
  dimension: string;
  baseline: number;
  post: number;
};

/**
 * Builds coordinate axes, series, and tooltip for baseline vs post comparison.
 * Adapts Y-axis dynamically:
 * - Single Y-axis (max 5 or 10) for small-scale dimensions (e.g. PANAS 1-5).
 * - Single Y-axis (max 100) for total-score dimensions (e.g. STAI 20-80).
 * - Dual Y-axes (left: STAI 20-80 / 100, right: PANAS 1-5) when both scales coexist,
 *   preventing Mood and Energy bars from shrinking to thin slivers.
 */
function buildComparisonAxesAndSeries(
  points: DimensionPoint[],
  baselineName: string,
  postName: string,
) {
  const categories = points.map((item) => labelForDimension(item.dimension));
  const hasSmall = points.some((p) => Math.max(p.baseline, p.post) <= 10);
  const hasLarge = points.some((p) => Math.max(p.baseline, p.post) > 10);
  const isMixed = hasSmall && hasLarge;

  if (points.length === 0) {
    return {
      categories,
      series: [
        {
          name: baselineName,
          type: 'bar',
          barGap: '25%',
          data: [],
          itemStyle: { borderRadius: [4, 4, 0, 0], color: BASELINE_COLOR },
        },
        {
          name: postName,
          type: 'bar',
          data: [],
          itemStyle: { borderRadius: [4, 4, 0, 0], color: POST_COLOR },
        },
      ],
      tooltip: {
        backgroundColor: 'rgba(23, 32, 38, 0.92)',
        borderWidth: 0,
        textStyle: { color: '#f5f0eb', fontSize: 12 },
        trigger: 'axis',
        valueFormatter: (value: number) => `${value} 分`,
      },
      yAxis: {
        axisLabel: { color: 'rgba(23, 32, 38, 0.56)' },
        splitLine: { lineStyle: { color: 'rgba(23, 32, 38, 0.1)' } },
        type: 'value',
        max: 100,
      },
    };
  }

  if (isMixed) {
    const smallScores = points
      .filter((p) => Math.max(p.baseline, p.post) <= 10)
      .flatMap((p) => [p.baseline, p.post]);
    const maxSmallVal = Math.max(...smallScores, 0);
    const smallMax = maxSmallVal <= 5 ? 5 : 10;

    const largeScores = points
      .filter((p) => Math.max(p.baseline, p.post) > 10)
      .flatMap((p) => [p.baseline, p.post]);
    const maxLargeVal = Math.max(...largeScores, 0);
    const largeMax = maxLargeVal > 100 ? Math.ceil(maxLargeVal * 1.1) : 100;

    return {
      categories,
      series: [
        {
          name: baselineName,
          type: 'bar',
          barGap: '25%',
          yAxisIndex: 0,
          data: points.map((p) => (Math.max(p.baseline, p.post) > 10 ? p.baseline : null)),
          itemStyle: { borderRadius: [4, 4, 0, 0], color: BASELINE_COLOR },
        },
        {
          name: postName,
          type: 'bar',
          yAxisIndex: 0,
          data: points.map((p) => (Math.max(p.baseline, p.post) > 10 ? p.post : null)),
          itemStyle: { borderRadius: [4, 4, 0, 0], color: POST_COLOR },
        },
        {
          name: baselineName,
          type: 'bar',
          barGap: '-100%',
          yAxisIndex: 1,
          data: points.map((p) => (Math.max(p.baseline, p.post) <= 10 ? p.baseline : null)),
          itemStyle: { borderRadius: [4, 4, 0, 0], color: BASELINE_COLOR },
        },
        {
          name: postName,
          type: 'bar',
          barGap: '25%',
          yAxisIndex: 1,
          data: points.map((p) => (Math.max(p.baseline, p.post) <= 10 ? p.post : null)),
          itemStyle: { borderRadius: [4, 4, 0, 0], color: POST_COLOR },
        },
      ],
      tooltip: {
        backgroundColor: 'rgba(23, 32, 38, 0.92)',
        borderWidth: 0,
        textStyle: { color: '#f5f0eb', fontSize: 12 },
        trigger: 'axis',
        formatter: (params: unknown) => {
          if (!Array.isArray(params)) return '';
          const valid = params.filter(
            (item) => item && item.value !== null && item.value !== undefined && item.value !== '-',
          );
          if (valid.length === 0) return '';
          const header =
            (valid[0] as { axisValueLabel?: string; name?: string }).axisValueLabel ??
            (valid[0] as { name?: string }).name ??
            '';
          const lines = valid.map((item) => {
            const val = Number((item as { value?: number }).value);
            const formatted = val <= 10 ? val.toFixed(1) : String(val);
            const marker = (item as { marker?: string }).marker ?? '';
            const seriesName = (item as { seriesName?: string }).seriesName ?? '';
            return `${marker}${seriesName}: ${formatted} 分`;
          });
          return `${header}<br/>${lines.join('<br/>')}`;
        },
      },
      yAxis: [
        {
          name: 'STAI (总分)',
          nameTextStyle: { color: 'rgba(23, 32, 38, 0.62)', fontSize: 11 },
          axisLabel: { color: 'rgba(23, 32, 38, 0.56)' },
          splitLine: { lineStyle: { color: 'rgba(23, 32, 38, 0.1)' } },
          type: 'value',
          min: 0,
          max: largeMax,
        },
        {
          name: 'PANAS (均分)',
          nameTextStyle: { color: 'rgba(23, 32, 38, 0.62)', fontSize: 11 },
          axisLabel: { color: 'rgba(23, 32, 38, 0.56)' },
          splitLine: { show: false },
          type: 'value',
          min: 0,
          max: smallMax,
        },
      ],
    };
  }

  // Single Y-axis case (pure small-scale or pure large-scale)
  const allScores = points.flatMap((p) => [p.baseline, p.post]);
  const maxScore = Math.max(...allScores, 0);
  let axisMax = 100;
  if (hasSmall && !hasLarge) {
    axisMax = maxScore <= 5 ? 5 : 10;
  } else if (maxScore > 100) {
    axisMax = Math.ceil(maxScore * 1.1);
  }

  return {
    categories,
    series: [
      {
        name: baselineName,
        type: 'bar',
        barGap: '25%',
        data: points.map((item) => item.baseline),
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: BASELINE_COLOR,
        },
      },
      {
        name: postName,
        type: 'bar',
        data: points.map((item) => item.post),
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: POST_COLOR,
        },
      },
    ],
    tooltip: {
      backgroundColor: 'rgba(23, 32, 38, 0.92)',
      borderWidth: 0,
      textStyle: { color: '#f5f0eb', fontSize: 12 },
      trigger: 'axis',
      valueFormatter: (value: number) =>
        value <= 10 ? `${Number(value).toFixed(1)} 分` : `${value} 分`,
    },
    yAxis: {
      axisLabel: { color: 'rgba(23, 32, 38, 0.56)' },
      splitLine: { lineStyle: { color: 'rgba(23, 32, 38, 0.1)' } },
      type: 'value',
      max: axisMax,
    },
  };
}

export function buildEffectChartOption(
  summary: RegulationEffectSummaryView,
  /** Post-series label. The natural-recovery (基线) leg regulates nothing, so
   *  it renders 静息后 instead of the default 调控后. */
  postLabel = '调控后',
): EffectChartOption {
  const points: DimensionPoint[] = summary.dimensions.map((item) => ({
    dimension: item.dimension,
    baseline: item.baseline,
    post: item.post,
  }));

  const { categories, series, tooltip, yAxis } = buildComparisonAxesAndSeries(
    points,
    '基线',
    postLabel,
  );

  return {
    animationDuration: chartAnimationDuration(),
    animationEasing: 'cubicOut',
    grid: {
      bottom: 28,
      containLabel: true,
      left: 12,
      right: Array.isArray(yAxis) ? 20 : 16,
      top: 44,
    },
    legend: {
      data: ['基线', postLabel],
      textStyle: { color: 'rgba(23, 32, 38, 0.72)', fontSize: 12 },
      top: 6,
    },
    series,
    tooltip,
    xAxis: {
      axisLabel: { color: 'rgba(23, 32, 38, 0.72)', fontSize: 12 },
      axisLine: { lineStyle: { color: 'rgba(23, 32, 38, 0.24)' } },
      axisTick: { show: false },
      data: categories,
      type: 'category',
    },
    yAxis,
  };
}

/* ------------------------------------------------------------------ */
/* Cross-condition comparison chart (R6, 大纲 6.2)                     */
/* ------------------------------------------------------------------ */

const NATURAL_RECOVERY_SERIES_LABEL = '基线 post';
const REGULATION_SERIES_LABEL = '调控 post';

/**
 * Bar chart comparing each condition's post scores (B_post vs T_post) per
 * dimension, 大纲 6.2 cross-condition view. Same shape conventions as the
 * in-run chart so the page can mount it through the same lazy echarts
 * wrapper.
 */
export function buildConditionComparisonChartOption(
  comparison: ConditionEffectComparisonView,
): EffectChartOption {
  const points: DimensionPoint[] = comparison.dimensions.map((item) => ({
    dimension: item.dimension,
    baseline: item.naturalRecoveryPost,
    post: item.regulationPost,
  }));

  const { categories, series, tooltip, yAxis } = buildComparisonAxesAndSeries(
    points,
    NATURAL_RECOVERY_SERIES_LABEL,
    REGULATION_SERIES_LABEL,
  );

  return {
    animationDuration: chartAnimationDuration(),
    animationEasing: 'cubicOut',
    grid: {
      bottom: 28,
      containLabel: true,
      left: 12,
      right: Array.isArray(yAxis) ? 20 : 16,
      top: 44,
    },
    legend: {
      data: [NATURAL_RECOVERY_SERIES_LABEL, REGULATION_SERIES_LABEL],
      textStyle: { color: 'rgba(23, 32, 38, 0.72)', fontSize: 12 },
      top: 6,
    },
    series,
    tooltip,
    xAxis: {
      axisLabel: { color: 'rgba(23, 32, 38, 0.72)', fontSize: 12 },
      axisLine: { lineStyle: { color: 'rgba(23, 32, 38, 0.24)' } },
      axisTick: { show: false },
      data: categories,
      type: 'category',
    },
    yAxis,
  };
}
