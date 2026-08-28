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
const POST_COLOR = '#df0203';

export function buildEffectChartOption(
  summary: RegulationEffectSummaryView,
): EffectChartOption {
  const categories = summary.dimensions.map((item) => labelForDimension(item.dimension));

  return {
    animationDuration: 520,
    animationEasing: 'cubicOut',
    grid: {
      bottom: 28,
      containLabel: true,
      left: 12,
      right: 16,
      top: 44,
    },
    legend: {
      data: ['基线', '调控后'],
      textStyle: { color: 'rgba(23, 32, 38, 0.72)', fontSize: 12 },
      top: 6,
    },
    series: [
      {
        name: '基线',
        type: 'bar',
        barGap: '25%',
        data: summary.dimensions.map((item) => item.baseline),
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: BASELINE_COLOR,
        },
      },
      {
        name: '调控后',
        type: 'bar',
        data: summary.dimensions.map((item) => item.post),
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
      valueFormatter: (value: number) => `${value} 分`,
    },
    xAxis: {
      axisLabel: { color: 'rgba(23, 32, 38, 0.72)', fontSize: 12 },
      axisLine: { lineStyle: { color: 'rgba(23, 32, 38, 0.24)' } },
      axisTick: { show: false },
      data: categories,
      type: 'category',
    },
    yAxis: {
      axisLabel: { color: 'rgba(23, 32, 38, 0.56)' },
      splitLine: { lineStyle: { color: 'rgba(23, 32, 38, 0.1)' } },
      type: 'value',
      max: 100,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Cross-condition comparison chart (R6, 大纲 6.2)                     */
/* ------------------------------------------------------------------ */

const NATURAL_RECOVERY_SERIES_LABEL = '基线条件（自然恢复）post';
const REGULATION_SERIES_LABEL = '调控条件 post';

/**
 * Bar chart comparing each condition's post scores (B_post vs T_post) per
 * dimension, 大纲 6.2 cross-condition view. Same shape conventions as the
 * in-run chart so the page can mount it through the same lazy echarts
 * wrapper.
 */
export function buildConditionComparisonChartOption(
  comparison: ConditionEffectComparisonView,
): EffectChartOption {
  const categories = comparison.dimensions.map((item) => labelForDimension(item.dimension));

  return {
    animationDuration: 520,
    animationEasing: 'cubicOut',
    grid: {
      bottom: 28,
      containLabel: true,
      left: 12,
      right: 16,
      top: 44,
    },
    legend: {
      data: [NATURAL_RECOVERY_SERIES_LABEL, REGULATION_SERIES_LABEL],
      textStyle: { color: 'rgba(23, 32, 38, 0.72)', fontSize: 12 },
      top: 6,
    },
    series: [
      {
        name: NATURAL_RECOVERY_SERIES_LABEL,
        type: 'bar',
        barGap: '25%',
        data: comparison.dimensions.map((item) => item.naturalRecoveryPost),
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: BASELINE_COLOR,
        },
      },
      {
        name: REGULATION_SERIES_LABEL,
        type: 'bar',
        data: comparison.dimensions.map((item) => item.regulationPost),
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
      valueFormatter: (value: number) => `${value} 分`,
    },
    xAxis: {
      axisLabel: { color: 'rgba(23, 32, 38, 0.72)', fontSize: 12 },
      axisLine: { lineStyle: { color: 'rgba(23, 32, 38, 0.24)' } },
      axisTick: { show: false },
      data: categories,
      type: 'category',
    },
    yAxis: {
      axisLabel: { color: 'rgba(23, 32, 38, 0.56)' },
      splitLine: { lineStyle: { color: 'rgba(23, 32, 38, 0.1)' } },
      type: 'value',
      max: 100,
    },
  };
}
