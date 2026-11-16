import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeRegulationEffect,
  exportEffectReport,
  listEffectHistory,
  savePhaseInstrumentRecord,
  type RegulationEffectSummaryView,
  type PhaseInstrumentRecordInput,
} from './scaleRecordsApi';
import { buildDeqMeasurement, DEQ_SCALE_ID, deqItems, type DeqAnswers } from './instruments/deq';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

function lastSaveInput(): PhaseInstrumentRecordInput {
  const calls = vi.mocked(invoke).mock.calls;
  return (calls[calls.length - 1]?.[1] as { input: PhaseInstrumentRecordInput }).input;
}

describe('DEQ measurements', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const deqInput = {
    userId: 'user-1',
    subjectId: ' subj-009 ',
    experimentRunId: 'run-1',
    ...buildDeqMeasurement({
      deq: Object.fromEntries(deqItems.map(({ id }) => [id, 4])) as DeqAnswers['deq'],
    }),
    phase: 'post' as const,
  };

  it('persists an explicit phase with a trimmed subject for the wizard flow', async () => {
    await savePhaseInstrumentRecord(deqInput);

    const input = lastSaveInput();
    expect(input.subjectId).toBe('subj-009');
    expect(input.phase).toBe('post');
    expect(input.scaleId).toBe(DEQ_SCALE_ID);
    expect(input.dimensionScores).toEqual({ anxiety: 4, sadness: 4, fear: 4 });
    expect(input.rawAnswers).toEqual(deqInput.rawAnswers);
    expect(input.measuredDimensions).toEqual(['anxiety', 'sadness', 'fear']);
  });

  it('forwards the run id and defaults optional context fields', async () => {
    await savePhaseInstrumentRecord({
      ...deqInput,
    });

    const input = lastSaveInput();
    expect(input.emotion).toBeNull();
    expect(input.condition).toBeNull();
    expect(input.durationMinutes).toBeNull();
    expect(input.regulationSkipped).toBe(false);

    await savePhaseInstrumentRecord({
      ...deqInput,
      phase: 'baseline',
    });
  });

  it('forwards the wizard run context (emotion, condition, duration, skip)', async () => {
    await savePhaseInstrumentRecord({
      ...deqInput,
      emotion: 'anxiety',
      condition: 'regulation',
      durationMinutes: 5,
      regulationSkipped: true,
    });

    const input = lastSaveInput();
    expect(input.emotion).toBe('anxiety');
    expect(input.condition).toBe('regulation');
    expect(input.durationMinutes).toBe(5);
    expect(input.regulationSkipped).toBe(true);
  });

  it('sends the run owning the pre-induction DEQ measurement to the atomic save', async () => {
    await savePhaseInstrumentRecord({
      ...deqInput,
      scaleId: 'deq_zh_state_12_v1',
      experimentRunId: 'run-1',
      phase: 'pre_induction',
    });
    expect(lastSaveInput()).toMatchObject({ experimentRunId: 'run-1', phase: 'pre_induction' });
  });

  it('resolves the saved record id so baseline/post can be paired', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: 'rec-post-1',
      userId: 'user-1',
      subjectId: 'subj-009',
      scaleId: DEQ_SCALE_ID,
      phase: 'post',
      dimensionScores: {},
      rawAnswers: {},
      createdAt: '2026-08-26T10:00:00+00:00',
    });

    const record = await savePhaseInstrumentRecord(deqInput);

    expect(record.id).toBe('rec-post-1');
  });

  it('invokes compute_regulation_effect with the camelCase record ids', async () => {
    const summary: RegulationEffectSummaryView = {
      subjectId: 'sub-001',
      emotionChanges: [],
    };
    vi.mocked(invoke).mockResolvedValueOnce(summary);

    const result = await computeRegulationEffect('rec-baseline-1', 'rec-post-1');

    expect(invoke).toHaveBeenCalledWith('compute_regulation_effect', {
      input: { baselineRecordId: 'rec-baseline-1', postRecordId: 'rec-post-1' },
    });
    expect(result).toEqual(summary);
  });

  it('loads the paired history without arguments', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);

    await expect(listEffectHistory()).resolves.toEqual([]);
    expect(invoke).toHaveBeenCalledWith('list_effect_history');
  });

  it('invokes export_effect_report with a camelCase single payload', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ path: 'C:/r.json', bytes: 12 });

    const result = await exportEffectReport({
      kind: 'single',
      path: 'C:/r.json',
      format: 'json',
      baselineRecordId: 'rec-b',
      postRecordId: 'rec-p',
    });

    expect(invoke).toHaveBeenCalledWith('export_effect_report', {
      input: {
        kind: 'single',
        path: 'C:/r.json',
        format: 'json',
        baselineRecordId: 'rec-b',
        postRecordId: 'rec-p',
      },
    });
    expect(result).toEqual({ path: 'C:/r.json', bytes: 12 });
  });

  it('omits the format field on batch exports (the backend forces csv)', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ path: 'C:/summary.csv', bytes: 20 });

    await exportEffectReport({ kind: 'batch', path: 'C:/summary.csv' });

    const calls = vi.mocked(invoke).mock.calls;
    const args = calls[calls.length - 1]?.[1];
    expect((args as { input: Record<string, unknown> }).input).toEqual({
      kind: 'batch',
      path: 'C:/summary.csv',
    });
    expect('format' in (args as { input: Record<string, unknown> }).input).toBe(false);
  });
});
