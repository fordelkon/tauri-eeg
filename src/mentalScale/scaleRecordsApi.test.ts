import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mentalScaleDefinitions,
  type MentalScaleAnswers,
  type MentalScaleDefinition,
} from './mentalScaleGate';
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
  savePhaseScaleRecord,
  saveScaleRecord,
  type RegulationEffectSummaryView,
  type ScaleRecordInput,
} from './scaleRecordsApi';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const videoScale = mentalScaleDefinitions['/video-regulation'];
const musicScale: MentalScaleDefinition = mentalScaleDefinitions['/music-regulation'];

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
      scaleId: '/video-regulation',
      phase: 'baseline',
      dimensionScores: { anxiety: 75, worry: 50, mood: 25, energy: 0 },
      rawAnswers: { 'video-anxiety-tense': 2 },
    });

    expect(invoke).toHaveBeenCalledWith('save_scale_record', {
      input: {
        userId: 'user-1',
        subjectId: null,
        scaleId: '/video-regulation',
        phase: 'baseline',
        dimensionScores: { anxiety: 75, worry: 50, mood: 25, energy: 0 },
        rawAnswers: { 'video-anxiety-tense': 2 },
      },
    });
  });

  it('persists a submission as a baseline record built from the scale answers', () => {
    const answers: MentalScaleAnswers = {
      'video-anxiety-tense': 3,
      'video-anxiety-worry': 1,
      'video-depression-interest': 0,
    };

    persistMentalScaleSubmission(videoScale, answers, 'user-1');

    expect(invoke).toHaveBeenCalledTimes(1);
    // Per-question scores: 3 -> 100, 1 -> 33, 0 -> 0; each dimension averages
    // its own questions. All four keys are stored (energy keeps its neutral
    // placeholder for radar/status display), but the R4/F1 marker list names
    // only the dimensions that actually received answers so the effect
    // computation can exclude the placeholder.
    expect(lastSaveInput()).toEqual({
      userId: 'user-1',
      subjectId: null,
      scaleId: '/video-regulation',
      phase: 'baseline',
      dimensionScores: { anxiety: 100, worry: 33, mood: 0, energy: 50 },
      rawAnswers: answers,
      measuredDimensions: ['anxiety', 'worry', 'mood'],
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
      persistMentalScaleSubmission(videoScale, { 'video-anxiety-tense': 2 }, 'user-1'),
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

    persistMentalScaleSubmission(videoScale, { 'video-anxiety-tense': 1 }, 'user-1');

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

  it('persists an explicit phase and trimmed subject for the wizard flow', async () => {
    const answers: MentalScaleAnswers = {
      'music-depression-low': 2,
      'music-depression-sleep': 3,
      'music-anxiety-relax': 1,
    };

    await savePhaseScaleRecord(musicScale, answers, {
      userId: 'user-1',
      subjectId: ' subj-009 ',
      phase: 'post',
    });

    const input = lastSaveInput();
    expect(input.subjectId).toBe('subj-009');
    expect(input.phase).toBe('post');
    expect(input.scaleId).toBe('/music-regulation');
  });

  it('marks measured dimensions and forwards the eeg session id (R4/F1+F2)', async () => {
    const answers: MentalScaleAnswers = {
      // Only the two mood/energy questions of the music scale.
      'music-depression-low': 2,
      'music-anxiety-relax': 0,
    };

    await savePhaseScaleRecord(musicScale, answers, {
      userId: 'user-1',
      subjectId: 'subj-009',
      phase: 'post',
      eegSessionId: 'eeg-run-42',
    });

    const input = lastSaveInput();
    expect(input.eegSessionId).toBe('eeg-run-42');
    expect(input.measuredDimensions).toEqual(['anxiety', 'mood']);

    await savePhaseScaleRecord(musicScale, answers, {
      userId: 'user-1',
      subjectId: 'subj-009',
      phase: 'baseline',
      eegSessionId: null,
    });

    expect(lastSaveInput().eegSessionId).toBeNull();
  });

  it('resolves the saved record id so baseline/post can be paired', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: 'rec-post-1',
      userId: 'user-1',
      subjectId: 'subj-009',
      scaleId: '/music-regulation',
      phase: 'post',
      dimensionScores: {},
      rawAnswers: {},
      createdAt: '2026-08-26T10:00:00+00:00',
    });

    const record = await savePhaseScaleRecord(musicScale, {}, {
      userId: 'user-1',
      subjectId: 'subj-009',
      phase: 'post',
    });

    expect(record.id).toBe('rec-post-1');
  });

  it('invokes compute_regulation_effect with the camelCase record ids', async () => {
    const summary: RegulationEffectSummaryView = {
      subjectId: 'subj-009',
      dimensions: [
        { dimension: 'anxiety', baseline: 80, post: 48, improvementRate: 0.4 },
      ],
      meanImprovementRate: 0.4,
      meetsThreshold: true,
      measuredOnly: true,
    };
    vi.mocked(invoke).mockResolvedValueOnce(summary);

    const result = await computeRegulationEffect('rec-baseline-1', 'rec-post-1');

    expect(invoke).toHaveBeenCalledWith('compute_regulation_effect', {
      input: { baselineRecordId: 'rec-baseline-1', postRecordId: 'rec-post-1' },
    });
    expect(result.meetsThreshold).toBe(true);
    expect(result.meanImprovementRate).toBe(0.4);
    expect(result.measuredOnly).toBe(true);
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
