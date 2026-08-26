import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mentalScaleDefinitions, type MentalScaleAnswers } from './mentalScaleGate';
import {
  defaultMentalScaleStatus,
  getMentalScaleStatusSnapshot,
  updateMentalScaleStatus,
} from './mentalScaleStatus';
import {
  persistMentalScaleSubmission,
  saveScaleRecord,
  type ScaleRecordInput,
} from './scaleRecordsApi';

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
    // its own questions (energy has none in this scale, so it keeps the
    // neutral default).
    expect(lastSaveInput()).toEqual({
      userId: 'user-1',
      subjectId: null,
      scaleId: '/video-regulation',
      phase: 'baseline',
      dimensionScores: { anxiety: 100, worry: 33, mood: 0, energy: 50 },
      rawAnswers: answers,
    });
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
