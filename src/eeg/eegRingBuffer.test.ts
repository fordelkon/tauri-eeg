import { describe, expect, it } from 'vitest';
import { DEFAULT_EEG_CHANNELS } from './channels';
import { EegRingBuffer } from './eegRingBuffer';
import type { EegDecodedSampleBlock } from './types';

const makeBlock = (
  sequence: number,
  startedAtMs: number,
  samples: number[][],
  triggerClass?: number | null,
): EegDecodedSampleBlock => ({
  sequence,
  sampleRateHz: 2,
  startedAtMs,
  triggerClass: triggerClass ?? null,
  samples: samples.map((channel) => Float32Array.from(channel)),
});

describe('EegRingBuffer', () => {
  it('keeps only samples inside the configured time window', () => {
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 2), 2);

    buffer.appendPayload(makeBlock(1, 0, [[1, 2], [10, 20]]));
    buffer.appendPayload(makeBlock(2, 1000, [[3, 4], [30, 40]]));
    buffer.appendPayload(makeBlock(3, 2000, [[5, 6], [50, 60]]));

    const snapshot = buffer.toDisplayData(new Set(['ch01', 'ch02']), 2);

    expect(snapshot.x).toEqual(Float64Array.from([1, 1.5, 2, 2.5]));
    expect(snapshot.seriesByChannel.ch01).toEqual(Float32Array.from([3, 4, 5, 6]));
    expect(snapshot.seriesByChannel.ch02).toEqual(Float32Array.from([30, 40, 50, 60]));
    expect(snapshot.latestSequence).toBe(3);
  });

  it('preserves the logical sample order across circular wraparound writes', () => {
    // maxWindowSeconds 1 at 2 Hz gives a capacity of 3 samples.
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 1), 2, 1);

    buffer.appendPayload(makeBlock(1, 0, [[1, 2, 3]]));
    buffer.appendPayload(makeBlock(2, 1500, [[4, 5]]));
    buffer.appendPayload(makeBlock(3, 2500, [[6]]));

    const snapshot = buffer.toDisplayData(new Set(['ch01']), 10);

    expect(snapshot.retainedSampleCount).toBe(3);
    expect(snapshot.x).toEqual(Float64Array.from([1.5, 2, 2.5]));
    expect(snapshot.seriesByChannel.ch01).toEqual(Float32Array.from([4, 5, 6]));
  });

  it('preserves configured channel order when extracting visible channels', () => {
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 3), 2);

    buffer.appendPayload(makeBlock(1, 0, [[1, 2], [10, 20], [100, 200]]));

    const snapshot = buffer.toDisplayData(new Set(['ch03', 'ch01']), 5);

    expect(snapshot.visibleChannels.map((channel) => channel.id)).toEqual(['ch01', 'ch03']);
  });

  it('clears all retained samples on reset', () => {
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 1), 2);

    buffer.appendPayload(makeBlock(1, 0, [[1, 2]]));
    buffer.reset();

    const snapshot = buffer.toDisplayData(new Set(['ch01']), 5);

    expect(snapshot.x).toEqual(new Float64Array(0));
    expect(snapshot.seriesByChannel.ch01).toEqual(new Float32Array(0));
    expect(snapshot.latestSequence).toBeNull();
  });

  it('keeps sparse trigger markers inside the configured time window', () => {
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 1), 2);

    buffer.appendPayload(makeBlock(1, 0, [[1, 2]], 255));
    buffer.appendPayload(makeBlock(2, 1000, [[3, 4]], null));
    buffer.appendPayload(makeBlock(3, 2000, [[5, 6]], 2));

    const snapshot = buffer.toDisplayData(new Set(['ch01']), 2);

    expect(snapshot.markers).toEqual([{ timeSeconds: 2, classId: 2 }]);
  });

  it('enforces the hard capacity cap on every append', () => {
    // maxWindowSeconds 1 at 2 Hz gives a capacity of 3 samples.
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 1), 2, 1);

    buffer.appendPayload(makeBlock(1, 0, [[1, 2, 3, 4, 5]]));
    buffer.appendPayload(makeBlock(2, 2500, [[6, 7]]));

    const snapshot = buffer.toDisplayData(new Set(['ch01']), 10);

    expect(snapshot.retainedSampleCount).toBeLessThanOrEqual(3);
    expect(snapshot.seriesByChannel.ch01).toEqual(Float32Array.from([5, 6, 7]));
  });

  it('maintains an incremental per-channel baseline at ingest time', () => {
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 1), 2);

    buffer.appendPayload(makeBlock(1, 0, [[100, 100, 100]]));
    buffer.appendPayload(makeBlock(2, 1500, [[-200, -200]]));

    const snapshot = buffer.toDisplayData(new Set(['ch01']), 10);

    expect(snapshot.baselineByChannel.ch01).toBeGreaterThan(-200);
    expect(snapshot.baselineByChannel.ch01).toBeLessThan(100);
  });

  it('exposes the latest block sequence for render-loop skipping', () => {
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 1), 2);

    expect(buffer.getLastSequence()).toBeNull();
    buffer.appendPayload(makeBlock(7, 0, [[1]]));
    expect(buffer.getLastSequence()).toBe(7);
  });
});
