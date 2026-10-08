import type { ConditionEffectComparisonView, RegulationEffectSummaryView } from '../../mentalScale/scaleRecordsApi';
import { describeFriendlyError } from '../../ui/friendlyError';
import type { EffectEvaluationFlowState } from './effectEvaluationFlow';
import { describeMissingMeasurements } from './effectEvaluationResultCopy';

type ReportState<T> =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; data: T }
  | { kind: 'failed'; error: string };

type ReportContext = Pick<EffectEvaluationFlowState, 'subjectId' | 'emotion' | 'baselineRecordId' | 'postRecordId'>;
type Snapshot = {
  summary: ReportState<RegulationEffectSummaryView>;
  comparison: ReportState<ConditionEffectComparisonView>;
};
export type EffectReportDependencies = {
  computeSummary(baselineRecordId: string, postRecordId: string): Promise<RegulationEffectSummaryView>;
  computeComparison(subjectId: string, emotion: string): Promise<ConditionEffectComparisonView>;
};

export class EffectResultReports {
  private snapshot: Snapshot = { summary: { kind: 'idle' }, comparison: { kind: 'idle' } };
  private listeners = new Set<() => void>();
  private summaryRequest = 0;
  private comparisonRequest = 0;
  private active = false;
  private readonly context: ReportContext;

  constructor(context: ReportContext, private readonly dependencies: EffectReportDependencies) {
    this.context = { ...context, subjectId: context.subjectId.trim() };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }

  start = () => {
    this.active = true;
    if (this.snapshot.summary.kind === 'idle') void this.loadSummary();
    if (this.snapshot.comparison.kind === 'idle') void this.loadConditionComparison();
  };

  clearResults = () => {
    this.summaryRequest += 1;
    this.comparisonRequest += 1;
    this.publish({ summary: { kind: 'idle' }, comparison: { kind: 'idle' } });
  };

  dispose = () => {
    this.active = false;
    this.clearResults();
  };

  loadSummary = async () => {
    if (!this.active) return;
    const request = ++this.summaryRequest;
    const { baselineRecordId, postRecordId } = this.context;
    if (!baselineRecordId || !postRecordId) {
      this.publish({ summary: { kind: 'failed', error: describeMissingMeasurements(this.context) ?? '缺少量表记录。' } });
      return;
    }
    this.publish({ summary: { kind: 'loading' } });
    try {
      const data = await this.dependencies.computeSummary(baselineRecordId, postRecordId);
      if (this.active && request === this.summaryRequest) this.publish({ summary: { kind: 'ready', data } });
    } catch (error) {
      if (this.active && request === this.summaryRequest) {
        this.publish({ summary: { kind: 'failed', error: describeFriendlyError(error, '计算调控效果') } });
      }
    }
  };

  loadConditionComparison = async () => {
    if (!this.active) return;
    const request = ++this.comparisonRequest;
    this.publish({ comparison: { kind: 'loading' } });
    try {
      const data = await this.dependencies.computeComparison(this.context.subjectId, this.context.emotion);
      if (this.active && request === this.comparisonRequest) this.publish({ comparison: { kind: 'ready', data } });
    } catch (error) {
      if (this.active && request === this.comparisonRequest) {
        this.publish({ comparison: { kind: 'failed', error: describeFriendlyError(error, '计算跨条件对比') } });
      }
    }
  };
}
