import type { RegulationEffectSummaryView } from '../../mentalScale/scaleRecordsApi';
import { describeFriendlyError } from '../../ui/friendlyError';

type Summary =
  | { kind: 'idle' | 'loading' }
  | { kind: 'ready'; data: RegulationEffectSummaryView }
  | { kind: 'failed'; error: string };
type ComputeSummary = (
  baselineRecordId: string,
  postRecordId: string,
) => Promise<RegulationEffectSummaryView>;

export class EffectResultReports {
  private snapshot: Summary = { kind: 'idle' };
  private listeners = new Set<() => void>();
  private request = 0;
  private active = false;

  constructor(
    private readonly baselineRecordId: string | null,
    private readonly postRecordId: string | null,
    private readonly compute: ComputeSummary,
  ) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(snapshot: Summary) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }

  start = () => {
    this.active = true;
    if (this.snapshot.kind === 'idle') void this.loadSummary();
  };

  clearResults = () => {
    this.request++;
    this.publish({ kind: 'idle' });
  };

  dispose = () => {
    this.active = false;
    this.clearResults();
  };

  loadSummary = async () => {
    if (!this.active) return;
    const request = ++this.request;
    if (!this.baselineRecordId || !this.postRecordId) {
      this.publish({ kind: 'failed', error: '缺少本次实验的量表记录，无法计算三时点变化。' });
      return;
    }
    this.publish({ kind: 'loading' });
    try {
      const data = await this.compute(this.baselineRecordId, this.postRecordId);
      if (data.emotionChanges.length !== 3) throw new Error('未读取到三个分量表的三时点评分。');
      if (request === this.request) this.publish({ kind: 'ready', data });
    } catch (error) {
      if (request === this.request)
        this.publish({ kind: 'failed', error: describeFriendlyError(error, '读取情绪评分') });
    }
  };
}
