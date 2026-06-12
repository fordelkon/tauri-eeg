import { describe, expect, it } from 'vitest';
import { toSweepDisplayData } from './eegSweepDisplay';
import type { EegDisplaySnapshot } from './types';

const snapshot: EegDisplaySnapshot = {
  latestSequence: 3,
  x: [8, 9, 10, 11, 12],
  visibleChannels: [
    { id: 'fp1', label: 'Fp1', unit: 'uV' },
    { id: 'fp2', label: 'Fp2', unit: 'uV' },
  ],
  seriesByChannel: {
    fp1: [80, 90, 100, 110, 120],
    fp2: [8, 9, 10, 11, 12],
  },
  markers: [
    { timeSeconds: 9, classId: 1 },
    { timeSeconds: 11, classId: 2 },
  ],
  retainedSampleCount: 5,
};

describe('toSweepDisplayData', () => {
  it('maps absolute sample times into a fixed monotonic plot window', () => {
    const sweep = toSweepDisplayData(snapshot, 10, 0);

    expect(sweep.x).toEqual([8, 9, 10, 11, 12]);
    expect(sweep.seriesByChannel.fp1).toEqual([80, 90, 100, 110, 120]);
    expect(sweep.seriesByChannel.fp2).toEqual([8, 9, 10, 11, 12]);
    expect(sweep.currentCycle).toBe(1);
    expect(sweep.cursorX).toBe(12);
    expect(sweep.x.every((x, index, values) => index === 0 || x > values[index - 1])).toBe(true);
  });

  it('keeps trigger markers only from the currently written sweep cycle', () => {
    const sweep = toSweepDisplayData(snapshot, 10, 0);

    expect(sweep.markers).toEqual([
      { timeSeconds: 9, classId: 1 },
      { timeSeconds: 11, classId: 2 },
    ]);
  });

  it('starts the first displayed sweep at the left edge even when source time is absolute', () => {
    const sweep = toSweepDisplayData({
      ...snapshot,
      x: [123.4, 123.9, 124.4],
      seriesByChannel: {
        fp1: [1, 2, 3],
        fp2: [10, 20, 30],
      },
      markers: [{ timeSeconds: 123.9, classId: 1 }],
    }, 10);

    expect(sweep.x).toEqual([0, 0.5, 1]);
    expect(sweep.cursorX).toBe(1);
    expect(sweep.markers).toEqual([{ timeSeconds: 0.5, classId: 1 }]);
  });

  it('uses a safe positive sweep window for empty snapshots', () => {
    const sweep = toSweepDisplayData({
      ...snapshot,
      x: [],
      seriesByChannel: { fp1: [], fp2: [] },
      markers: [],
      retainedSampleCount: 0,
    }, 0);

    expect(sweep.x).toEqual([]);
    expect(sweep.cursorX).toBe(0);
    expect(sweep.currentCycle).toBe(0);
  });
});
