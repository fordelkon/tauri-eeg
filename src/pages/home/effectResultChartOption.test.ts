import { describe, expect, it } from 'vitest';
import type {
  ConditionEffectComparisonView,
  RegulationEffectSummaryView,
} from '../../mentalScale/scaleRecordsApi';
import {
  buildConditionComparisonChartOption,
  buildEffectChartOption,
} from './effectResultChartOption';

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

function mixedSummaryFixture(): RegulationEffectSummaryView {
  return {
    subjectId: 'subj-042',
    dimensions: [
      { dimension: 'anxiety', baseline: 65, post: 42, improvementRate: 0.35 },
      { dimension: 'mood', baseline: 3.2, post: 2.1, improvementRate: 0.34 },
      { dimension: 'energy', baseline: 4.1, post: 2.8, improvementRate: 0.31 },
    ],
    meanImprovementRate: 0.33,
    meetsThreshold: true,
    measuredOnly: true,
  };
}

function purePanasSummaryFixture(): RegulationEffectSummaryView {
  return {
    subjectId: 'subj-042',
    dimensions: [
      { dimension: 'mood', baseline: 3.2, post: 2.1, improvementRate: 0.34 },
      { dimension: 'energy', baseline: 4.1, post: 2.8, improvementRate: 0.31 },
    ],
    meanImprovementRate: 0.33,
    meetsThreshold: true,
    measuredOnly: true,
  };
}

describe('buildEffectChartOption', () => {
  it('pairs baseline/post series with Chinese dimension categories for uniform scale', () => {
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

    // Scores live on a fixed 0–100 scale when all are total scores.
    expect(option.yAxis.type).toBe('value');
    expect(option.yAxis.max).toBe(100);
    expect(option.legend.data).toEqual(['基线', '调控后']);
  });

  it('dynamically adapts Y-axis to 5 for pure PANAS (1-5 score) dimensions', () => {
    const option = buildEffectChartOption(purePanasSummaryFixture()) as {
      series: Array<{ name: string; data: number[] }>;
      xAxis: { data: string[] };
      yAxis: { max: number; min: number; type: string };
    };

    expect(option.xAxis.data).toEqual(['情绪', '精力']);
    expect(option.yAxis.max).toBe(5);
    expect(option.series).toHaveLength(2);
    expect(option.series[0].data).toEqual([3.2, 4.1]);
    expect(option.series[1].data).toEqual([2.1, 2.8]);
  });

  it('generates dual Y-axes when STAI (20-80) and PANAS (1-5) coexist', () => {
    const option = buildEffectChartOption(mixedSummaryFixture()) as {
      legend: { data: string[] };
      series: Array<{
        name: string;
        data: Array<number | null>;
        yAxisIndex?: number;
        barGap?: string;
      }>;
      xAxis: { data: string[] };
      yAxis: Array<{ max: number; min: number; name: string }>;
    };

    expect(option.xAxis.data).toEqual(['焦虑', '情绪', '精力']);
    expect(Array.isArray(option.yAxis)).toBe(true);
    expect(option.yAxis).toHaveLength(2);
    expect(option.yAxis[0].name).toContain('STAI');
    expect(option.yAxis[0].max).toBe(100);
    expect(option.yAxis[1].name).toContain('PANAS');
    expect(option.yAxis[1].max).toBe(5);

    // 4 series: 2 on left axis (STAI), 2 on right axis (PANAS)
    expect(option.series).toHaveLength(4);
    expect(option.series[0].yAxisIndex).toBe(0);
    expect(option.series[0].data).toEqual([65, null, null]);
    expect(option.series[1].yAxisIndex).toBe(0);
    expect(option.series[1].data).toEqual([42, null, null]);

    expect(option.series[2].yAxisIndex).toBe(1);
    expect(option.series[2].barGap).toBe('-100%');
    expect(option.series[2].data).toEqual([null, 3.2, 4.1]);
    expect(option.series[3].yAxisIndex).toBe(1);
    expect(option.series[3].data).toEqual([null, 2.1, 2.8]);
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

describe('buildConditionComparisonChartOption', () => {
  it('generates dual Y-axes for mixed-scale cross-condition comparisons', () => {
    const comparisonFixture: ConditionEffectComparisonView = {
      subjectId: 'subj-001',
      emotion: 'anxiety',
      naturalRecoveryLeg: {
        condition: 'natural_recovery',
        emotion: 'anxiety',
        baselineRecordId: 'rec-b1',
        postRecordId: 'rec-p1',
        baselineCreatedAt: '2026-10-13T10:00:00Z',
        postCreatedAt: '2026-10-13T10:05:00Z',
        scaleId: 'stai_panas_battery_v1',
        durationMinutes: 5,
        regulationSkipped: false,
        measuredOnly: true,
      },
      regulationLeg: {
        condition: 'regulation',
        emotion: 'anxiety',
        baselineRecordId: 'rec-b2',
        postRecordId: 'rec-p2',
        baselineCreatedAt: '2026-10-13T10:30:00Z',
        postCreatedAt: '2026-10-13T10:35:00Z',
        scaleId: 'stai_panas_battery_v1',
        durationMinutes: 5,
        regulationSkipped: false,
        measuredOnly: true,
      },
      dimensions: [
        {
          dimension: 'anxiety',
          naturalRecoveryPost: 55,
          regulationPost: 38,
          improvementRate: 0.31,
        },
        {
          dimension: 'mood',
          naturalRecoveryPost: 2.9,
          regulationPost: 1.8,
          improvementRate: 0.38,
        },
      ],
      meanImprovementRate: 0.345,
      meetsThreshold: true,
      measuredOnly: true,
    };

    const option = buildConditionComparisonChartOption(comparisonFixture) as {
      series: Array<{ name: string; data: Array<number | null>; yAxisIndex?: number }>;
      xAxis: { data: string[] };
      yAxis: Array<{ max: number; name: string }>;
    };

    expect(option.xAxis.data).toEqual(['焦虑', '情绪']);
    expect(Array.isArray(option.yAxis)).toBe(true);
    expect(option.yAxis[0].name).toContain('STAI');
    expect(option.yAxis[1].name).toContain('PANAS');
    expect(option.yAxis[1].max).toBe(5);

    expect(option.series).toHaveLength(4);
    expect(option.series[0].name).toBe('基线 post');
    expect(option.series[0].data).toEqual([55, null]);
    expect(option.series[1].name).toBe('调控 post');
    expect(option.series[1].data).toEqual([38, null]);

    expect(option.series[2].name).toBe('基线 post');
    expect(option.series[2].data).toEqual([null, 2.9]);
    expect(option.series[3].name).toBe('调控 post');
    expect(option.series[3].data).toEqual([null, 1.8]);
  });
});
