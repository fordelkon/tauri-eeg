import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mentalScaleDefinitions, type MentalScaleAnswers } from './mentalScaleGate';
import {
  defaultMentalScaleStatus,
  getMentalScaleStatusSnapshot,
  updateMentalScaleStatus,
} from './mentalScaleStatus';
import {
  computeRegulationEffect,
  exportEffectReport,
  listEffectHistory,
  persistMentalScaleSubmission,
  savePhaseInstrumentRecord,
  saveScaleRecord,
  type RegulationEffectSummaryView,
  type ScaleRecordInput,
} from './scaleRecordsApi';
import { PHQ4_SCALE_ID } from './instruments/phq4';
import { buildDeqMeasurement, DEQ_SCALE_ID, deqItems, type DeqAnswers } from './instruments/deq';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const videoScale = mentalScaleDefinitions['/video-regulation'];

function lastSaveInput(): ScaleRecordInput {
  const calls = vi.mocked(invoke).mock.calls;
  const last = calls[calls.length - 1];
  return (last?.[1] as { input: ScaleRecordInput }).input;
}

describe('scaleRecordsApi', () => {
  beforeEach(() => {
    // Default happy path; individual tests override with *Once as needed.
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('invokes save_scale_record with a camelCase payload', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await saveScaleRecord({
      userId: 'user-1',
      subjectId: null,
      scaleId: PHQ4_SCALE_ID,
      phase: 'baseline',
      dimensionScores: { anxiety: 75, worry: 50, mood: 25, energy: 0 },
      rawAnswers: { phq4_1: 2, timeframe: 'past_2_weeks' },
    });

    expect(invoke).toHaveBeenCalledWith('save_scale_record', {
      input: {
        userId: 'user-1',
        subjectId: null,
        scaleId: PHQ4_SCALE_ID,
        phase: 'baseline',
        dimensionScores: { anxiety: 75, worry: 50, mood: 25, energy: 0 },
        rawAnswers: { phq4_1: 2, timeframe: 'past_2_weeks' },
      },
    });
  });

  it('persists a gate submission with the current-state instrument ID and timeframe', () => {
    const answers: MentalScaleAnswers = {
      unpleasant_now: 2,
      tension_now: 0,
    };

    persistMentalScaleSubmission(videoScale, answers, 'user-1');

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(lastSaveInput()).toEqual({
      userId: 'user-1',
      subjectId: null,
      scaleId: 'momentary_checkin_2_v1',
      phase: 'baseline',
      dimensionScores: { anxiety: 0, worry: 50, mood: 67, energy: 50 },
      rawAnswers: { ...answers, timeframe: 'now' },
      measuredDimensions: ['anxiety', 'mood'],
    });
  });

  it('marks zero measured dimensions when nothing was answered (R4/F1)', () => {
    persistMentalScaleSubmission(videoScale, {}, 'user-1');

    // The explicit empty list is honest ("nothing was measured") and must not
    // degrade to an unmarked legacy record.
    expect(lastSaveInput().measuredDimensions).toEqual([]);
  });

  it('leaves the in-memory status cache untouched', () => {
    updateMentalScaleStatus({ ...defaultMentalScaleStatus, updatedAt: 123 });

    persistMentalScaleSubmission(videoScale, {}, null);

    // The helper recomputes scores locally instead of reading or writing the
    // module-level cache; the gate keeps owning that state.
    expect(getMentalScaleStatusSnapshot().updatedAt).toBe(123);
  });

  it('swallows persistence failures so the gate flow is never blocked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValueOnce(new Error('db unavailable'));

    expect(() =>
      persistMentalScaleSubmission(videoScale, { tension_now: 2 }, 'user-1'),
    ).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warn).toHaveBeenCalledWith('[mentalScale] 量表记录落库失败:', expect.any(Error));
    warn.mockRestore();
  });
});

describe('subject_id passthrough (R2 效果闭环)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Installs a fake window whose localStorage backs the shared subject memory. */
  function stubSharedSubjectMemory(subjectId: string | null) {
    const entries = new Map<string, string>();
    if (subjectId !== null) {
      entries.set('paradigm.subjectId', subjectId);
    }
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => void entries.set(key, value),
      },
    });
    return entries;
  }

  it('falls back to the shared subject memory when no explicit binding is given', () => {
    stubSharedSubjectMemory('subj-paradigm');

    persistMentalScaleSubmission(videoScale, { tension_now: 1 }, 'user-1');

    // Gate submissions (no options) inherit the operator's last subject.
    expect(lastSaveInput().subjectId).toBe('subj-paradigm');
  });

  it('keeps null subject when the shared memory was never set', () => {
    stubSharedSubjectMemory(null);

    persistMentalScaleSubmission(videoScale, {}, 'user-1');

    expect(lastSaveInput().subjectId).toBeNull();
  });

  it('lets an explicit blank binding win over the shared memory', () => {
    stubSharedSubjectMemory('subj-paradigm');

    // The wizard passes its own subject explicitly; an empty one must not be
    // silently replaced by an unrelated stored value.
    persistMentalScaleSubmission(videoScale, {}, 'user-1', { subjectId: '   ' });

    expect(lastSaveInput().subjectId).toBeNull();
  });
});

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
