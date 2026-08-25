import { describe, expect, it } from 'vitest';
import { sweepEraseGapSeconds, toSweepDisplayData, toSweepPageData } from './eegSweepDisplay';
import type { EegDisplaySnapshot } from './types';

const snapshot: EegDisplaySnapshot = {
  latestSequence: 3,
  x: Float64Array.from([8, 9, 10, 11, 12]),
  visibleChannels: [
    { id: 'fp1', label: 'Fp1', unit: 'uV' },
    { id: 'fp2', label: 'Fp2', unit: 'uV' },
  ],
  seriesByChannel: {
    fp1: Float32Array.from([80, 90, 100, 110, 120]),
    fp2: Float32Array.from([8, 9, 10, 11, 12]),
  },
  baselineByChannel: {
    fp1: 0,
    fp2: 0,
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

    expect(sweep.x).toEqual(Float64Array.from([8, 9, 10, 11, 12]));
    expect(sweep.seriesByChannel.fp1).toEqual(Float32Array.from([80, 90, 100, 110, 120]));
    expect(sweep.seriesByChannel.fp2).toEqual(Float32Array.from([8, 9, 10, 11, 12]));
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
      x: Float64Array.from([123.4, 123.9, 124.4]),
      seriesByChannel: {
        fp1: Float32Array.from([1, 2, 3]),
        fp2: Float32Array.from([10, 20, 30]),
      },
      markers: [{ timeSeconds: 123.9, classId: 1 }],
    }, 10);

    expect(sweep.x).toEqual(Float64Array.from([0, 0.5, 1]));
    expect(sweep.cursorX).toBe(1);
    expect(sweep.markers).toEqual([{ timeSeconds: 0.5, classId: 1 }]);
  });

  it('uses a safe positive sweep window for empty snapshots', () => {
    const sweep = toSweepDisplayData({
      ...snapshot,
      x: new Float64Array(0),
      seriesByChannel: { fp1: new Float32Array(0), fp2: new Float32Array(0) },
      markers: [],
      retainedSampleCount: 0,
    }, 0);

    expect(sweep.x).toEqual(new Float64Array(0));
    expect(sweep.cursorX).toBe(0);
    expect(sweep.currentCycle).toBe(0);
  });
});

describe('toSweepPageData', () => {
  it('folds a wrapped window onto a fixed page with ascending phases', () => {
    const page = toSweepPageData({
      x: Float64Array.from([8, 9, 10.5, 11.5]),
      seriesByChannel: {
        fp1: Float32Array.from([1, 2, 3, 4]),
      },
    }, 10);

    // The current cycle (phases 0.5, 1.5) moves to the front, the previous
    // cycle's tail (8, 9) follows; uPlot needs x ascending.
    expect(page.x).toEqual(Float64Array.from([0.5, 1.5, 8, 9]));
    expect(page.seriesByChannel.fp1).toEqual(Float32Array.from([3, 4, 1, 2]));
    expect(page.cursorX).toBe(1.5);
  });

  it('keeps the early-stream page in chronological order before the first wrap', () => {
    const page = toSweepPageData({
      x: Float64Array.from([0, 1, 2]),
      seriesByChannel: {
        fp1: Float32Array.from([7, 8, 9]),
      },
    }, 10);

    expect(page.x).toEqual(Float64Array.from([0, 1, 2]));
    expect(page.seriesByChannel.fp1).toEqual(Float32Array.from([7, 8, 9]));
    expect(page.cursorX).toBe(2);
  });

  it('drops only the markers the erase band is about to overwrite', () => {
    const page = toSweepPageData({
      x: Float64Array.from([1.5, 2]),
      seriesByChannel: { fp1: Float32Array.from([0, 0]) },
    }, 10, [
      { timeSeconds: 2.2, classId: 1 },  // inside the band ahead of the cursor
      { timeSeconds: 1.5, classId: 2 },  // behind the cursor (current cycle)
      { timeSeconds: 5, classId: 3 },    // previous cycle, not reached yet
    ]);

    expect(page.markers).toEqual([
      { timeSeconds: 1.5, classId: 2 },
      { timeSeconds: 5, classId: 3 },
    ]);
  });

  it('drops markers in the part of the erase band that wraps past the page end', () => {
    // Window 10 s → erase gap 0.4 s; cursor at 9.8 wraps the band to [0, 0.2].
    const page = toSweepPageData({
      x: Float64Array.from([9.7, 9.8]),
      seriesByChannel: { fp1: Float32Array.from([0, 0]) },
    }, 10, [
      { timeSeconds: 0.1, classId: 1 },  // inside the wrapped band
      { timeSeconds: 0.5, classId: 2 },  // past it
    ]);

    expect(page.markers).toEqual([{ timeSeconds: 0.5, classId: 2 }]);
  });

  it('sizes the erase band like a monitor erase bar', () => {
    expect(sweepEraseGapSeconds(5)).toBe(0.25);
    expect(sweepEraseGapSeconds(10)).toBe(0.4);
    expect(sweepEraseGapSeconds(30)).toBe(0.4);
    expect(sweepEraseGapSeconds(1)).toBe(0.05);
  });
});
