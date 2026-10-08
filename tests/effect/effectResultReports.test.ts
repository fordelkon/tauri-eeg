import { describe, expect, test, vi } from 'vitest';
import type { ConditionComparisonLegView, ConditionEffectComparisonView, RegulationEffectSummaryView } from '../../src/mentalScale/scaleRecordsApi';
import { EffectResultReports, type EffectReportDependencies } from '../../src/pages/home/effectResultReports';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

const summary: RegulationEffectSummaryView = {
  subjectId: 'subject', dimensions: [], meanImprovementRate: 0.25, meetsThreshold: true, measuredOnly: true,
};
function leg(condition: string): ConditionComparisonLegView {
  return { condition, emotion: 'anxiety', baselineRecordId: 'baseline', postRecordId: 'post',
    baselineCreatedAt: '2026-10-09', postCreatedAt: '2026-10-09', scaleId: 'battery',
    durationMinutes: 1, regulationSkipped: false, measuredOnly: true };
}
const comparison: ConditionEffectComparisonView = {
  subjectId: 'subject', emotion: 'anxiety', naturalRecoveryLeg: leg('natural_recovery'),
  regulationLeg: leg('regulation'), dimensions: [], meanImprovementRate: 0.3, meetsThreshold: true, measuredOnly: true,
};

function fixture(records: { baselineRecordId: string | null; postRecordId: string | null } = {
  baselineRecordId: 'baseline', postRecordId: 'post',
}) {
  const dependencies = {
    computeSummary: vi.fn(async () => summary),
    computeComparison: vi.fn(async () => comparison),
  } satisfies EffectReportDependencies;
  const reports = new EffectResultReports({ subjectId: ' subject ', emotion: 'anxiety', ...records }, dependencies);
  return { reports, dependencies };
}

describe('effect report lifecycle', () => {
  test('loads both reports independently with the frozen query and caches snapshots', async () => {
    const { reports, dependencies } = fixture();
    const listener = vi.fn();
    const unsubscribe = reports.subscribe(listener);
    expect(reports.getSnapshot()).toBe(reports.getSnapshot());
    reports.start();
    reports.start();
    expect(reports.getSnapshot()).toEqual({ summary: { kind: 'loading' }, comparison: { kind: 'loading' } });
    await vi.waitFor(() => expect(reports.getSnapshot()).toEqual({
      summary: { kind: 'ready', data: summary }, comparison: { kind: 'ready', data: comparison },
    }));
    expect(dependencies.computeSummary).toHaveBeenCalledExactlyOnceWith('baseline', 'post');
    expect(dependencies.computeComparison).toHaveBeenCalledExactlyOnceWith('subject', 'anxiety');
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    reports.clearResults();
    expect(listener).toHaveBeenCalledTimes(4);
  });

  test.each([
    { baselineRecordId: null, postRecordId: 'post', missing: '基线' },
    { baselineRecordId: 'baseline', postRecordId: null, missing: '调控后' },
    { baselineRecordId: null, postRecordId: null, missing: '基线与调控后' },
  ])('does not compute a summary when $missing measurements are absent', async ({ missing, ...records }) => {
    const { reports, dependencies } = fixture(records);
    reports.start();
    expect(dependencies.computeSummary).not.toHaveBeenCalled();
    expect(reports.getSnapshot().summary).toEqual({ kind: 'failed', error:
      `缺少${missing}量表记录，无法计算改善率。请完整走完 诱发 → 诱发后量表 → 条件执行 → 条件后量表 流程。` });
    await vi.waitFor(() => expect(reports.getSnapshot().comparison).toEqual({ kind: 'ready', data: comparison }));
  });

  test('reset invalidates successes and failures from both unfinished reports', async () => {
    const { reports, dependencies } = fixture();
    const oldSummary = deferred<RegulationEffectSummaryView>();
    const oldComparison = deferred<ConditionEffectComparisonView>();
    dependencies.computeSummary.mockReturnValueOnce(oldSummary.promise);
    dependencies.computeComparison.mockReturnValueOnce(oldComparison.promise);
    reports.start();
    reports.clearResults();
    const resetSnapshot = reports.getSnapshot();
    oldSummary.resolve(summary);
    oldComparison.reject(new Error('旧请求失败'));
    await Promise.allSettled([oldSummary.promise, oldComparison.promise]);
    expect(reports.getSnapshot()).toBe(resetSnapshot);
    expect(reports.getSnapshot()).toEqual({ summary: { kind: 'idle' }, comparison: { kind: 'idle' } });
  });

  test('a late failure cannot finish the loading state of a newer retry', async () => {
    const { reports, dependencies } = fixture();
    const oldSummary = deferred<RegulationEffectSummaryView>();
    const newSummary = deferred<RegulationEffectSummaryView>();
    dependencies.computeSummary.mockReturnValueOnce(oldSummary.promise).mockReturnValueOnce(newSummary.promise);
    reports.start();
    const retry = reports.loadSummary();
    oldSummary.reject(new Error('旧请求失败'));
    await Promise.allSettled([oldSummary.promise]);
    expect(reports.getSnapshot().summary).toEqual({ kind: 'loading' });
    newSummary.resolve(summary);
    await retry;
    expect(reports.getSnapshot().summary).toEqual({ kind: 'ready', data: summary });
  });

  test('late successes do not replace newer summary or comparison results', async () => {
    const { reports, dependencies } = fixture();
    const oldSummary = deferred<RegulationEffectSummaryView>();
    const oldComparison = deferred<ConditionEffectComparisonView>();
    dependencies.computeSummary.mockReturnValueOnce(oldSummary.promise);
    dependencies.computeComparison.mockReturnValueOnce(oldComparison.promise);
    reports.start();
    await Promise.all([reports.loadSummary(), reports.loadConditionComparison()]);
    const latestSnapshot = reports.getSnapshot();
    oldSummary.resolve({ ...summary, meanImprovementRate: -0.9 });
    oldComparison.resolve({ ...comparison, meanImprovementRate: -0.8 });
    await Promise.all([oldSummary.promise, oldComparison.promise]);
    expect(reports.getSnapshot()).toBe(latestSnapshot);
    expect(reports.getSnapshot()).toEqual({ summary: { kind: 'ready', data: summary }, comparison: { kind: 'ready', data: comparison } });
  });

  test('current failures remain retryable without discarding the other report', async () => {
    const { reports, dependencies } = fixture();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      dependencies.computeComparison.mockRejectedValueOnce(new Error('尚无自然恢复记录'));
      reports.start();
      await vi.waitFor(() => expect(reports.getSnapshot()).toEqual({
        summary: { kind: 'ready', data: summary }, comparison: { kind: 'failed', error: '尚无自然恢复记录' },
      }));
      await reports.loadConditionComparison();
      expect(reports.getSnapshot().comparison).toEqual({ kind: 'ready', data: comparison });
      expect(dependencies.computeSummary).toHaveBeenCalledTimes(1);
    } finally { consoleError.mockRestore(); }
  });

  test('dispose blocks callbacks and supports the React setup-cleanup-setup lifecycle', async () => {
    const { reports, dependencies } = fixture();
    const oldSummary = deferred<RegulationEffectSummaryView>();
    const oldComparison = deferred<ConditionEffectComparisonView>();
    dependencies.computeSummary.mockReturnValueOnce(oldSummary.promise);
    dependencies.computeComparison.mockReturnValueOnce(oldComparison.promise);
    reports.start();
    reports.dispose();
    await Promise.all([reports.loadSummary(), reports.loadConditionComparison()]);
    expect(dependencies.computeSummary).toHaveBeenCalledTimes(1);
    expect(dependencies.computeComparison).toHaveBeenCalledTimes(1);
    reports.start();
    await vi.waitFor(() => expect(reports.getSnapshot().summary).toEqual({ kind: 'ready', data: summary }));
    const currentSnapshot = reports.getSnapshot();
    oldSummary.resolve({ ...summary, subjectId: 'previous-subject' });
    oldComparison.reject(new Error('旧请求失败'));
    await Promise.allSettled([oldSummary.promise, oldComparison.promise]);
    expect(reports.getSnapshot()).toBe(currentSnapshot);
  });
});
