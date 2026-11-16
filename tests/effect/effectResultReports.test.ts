import { describe, expect, test, vi } from 'vitest';
import type { RegulationEffectSummaryView } from '../../src/mentalScale/scaleRecordsApi';
import { EffectResultReports } from '../../src/pages/home/effectResultReports';

const summary: RegulationEffectSummaryView = {
  subjectId: 'subject',
  emotionChanges: (['anxiety', 'sadness', 'fear'] as const).map((dimension) => ({
    dimension,
    preInduction: 2,
    baseline: 5,
    post: 3,
    inductionChange: 3,
    conditionChange: -2,
  })),
};

describe('three-timepoint report', () => {
  test('requests the saved run once and publishes the three subscales', async () => {
    const compute = vi.fn().mockResolvedValue(summary);
    const reports = new EffectResultReports('baseline', 'post', compute);
    reports.start();
    reports.start();
    await vi.waitFor(() => expect(reports.getSnapshot()).toEqual({ kind: 'ready', data: summary }));
    expect(compute).toHaveBeenCalledExactlyOnceWith('baseline', 'post');
  });

  test('an incomplete run cannot produce a result', () => {
    const compute = vi.fn();
    const reports = new EffectResultReports(null, 'post', compute);
    reports.start();
    expect(reports.getSnapshot().kind).toBe('failed');
    expect(compute).not.toHaveBeenCalled();
  });

  test('retry after an incomplete report can load all three subscales', async () => {
    const compute = vi
      .fn()
      .mockResolvedValueOnce({ ...summary, emotionChanges: [] })
      .mockResolvedValue(summary);
    const reports = new EffectResultReports('baseline', 'post', compute);
    reports.start();
    await vi.waitFor(() => expect(reports.getSnapshot().kind).toBe('failed'));
    await reports.loadSummary();
    expect(reports.getSnapshot()).toEqual({ kind: 'ready', data: summary });
  });

  test('late responses cannot repopulate a cleared run', async () => {
    let resolve!: (result: RegulationEffectSummaryView) => void;
    const reports = new EffectResultReports(
      'baseline',
      'post',
      () =>
        new Promise<RegulationEffectSummaryView>((accept) => {
          resolve = accept;
        }),
    );
    reports.start();
    reports.dispose();
    resolve(summary);
    await Promise.resolve();
    expect(reports.getSnapshot()).toEqual({ kind: 'idle' });
  });
});
