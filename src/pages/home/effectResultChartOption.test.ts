import { describe, expect, it } from 'vitest';
import type { RegulationEffectSummaryView } from '../../mentalScale/scaleRecordsApi';
import { buildEffectChartOption } from './effectResultChartOption';

/** The bar-chart option is built by a pure function so its shape is testable
 * without mounting echarts (mirrors the radar-chart registration split). */

function summaryFixture(): RegulationEffectSummaryView {
  return {
    subjectId: 'subj-042',
    dimensions: [
      { dimension: 'anxiety', baseline: 80, post: 48, improvementRate: 0.4 },
      { dimension: 'mood', baseline: 50, post: 55, improvementRate: -0.1 },
    ],
    meanImprovementRate: 0.15,
    meetsThreshold: true,
    measuredOnly: true,
  };
}

describe('buildEffectChartOption', () => {
  it('pairs baseline/post series with Chinese dimension categories', () => {
    const option = buildEffectChartOption(summaryFixture()) as {
      legend: { data: string[] };
      series: Array<{ name: string; data: number[]; type: string }>;
      xAxis: { data: string[]; type: string };
      yAxis: { max: number; type: string };
    };

    // Categories reuse the wizard's dimension labels.
    expect(option.xAxis.data).toEqual(['焦虑', '情绪']);
    expect(option.xAxis.type).toBe('category');

    expect(option.series).toHaveLength(2);
    expect(option.series[0].name).toBe('基线');
    expect(option.series[0].data).toEqual([80, 50]);
    expect(option.series[0].type).toBe('bar');
    expect(option.series[1].name).toBe('调控后');
    expect(option.series[1].data).toEqual([48, 55]);

    // Scores live on a fixed 0–100 scale.
    expect(option.yAxis.type).toBe('value');
    expect(option.yAxis.max).toBe(100);
    expect(option.legend.data).toEqual(['基线', '调控后']);
  });

  it('renders an empty chart for a summary without comparable dimensions', () => {
    const option = buildEffectChartOption({
      subjectId: null,
      dimensions: [],
      meanImprovementRate: null,
      meetsThreshold: false,
      measuredOnly: false,
    }) as { series: Array<{ data: number[] }>; xAxis: { data: string[] } };

    expect(option.xAxis.data).toEqual([]);
    expect(option.series.every((series) => series.data.length === 0)).toBe(true);
  });
});
