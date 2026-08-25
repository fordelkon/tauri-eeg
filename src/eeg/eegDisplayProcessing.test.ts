import { describe, expect, it } from 'vitest';
import { processEegDisplayData } from './eegDisplayProcessing';

describe('processEegDisplayData', () => {
  it('removes per-channel DC offset with the precomputed baseline and clips values for display only', () => {
    const input = {
      x: Float64Array.from([0, 1, 2, 3]),
      seriesByChannel: {
        ch01: Float32Array.from([100_000, 100_010, 99_990, 100_500]),
        ch02: Float32Array.from([-207_320, -207_310, -207_330, -207_320]),
      },
      baselineByChannel: {
        ch01: 100_000,
        ch02: -207_320,
      },
    };

    const processed = processEegDisplayData(input, {
      clipUv: 100,
      targetPointCount: 100,
    });

    expect(processed.x).toEqual(Float64Array.from([0, 1, 2, 3]));
    expect(processed.seriesByChannel.ch01).toEqual(Float32Array.from([0, 10, -10, 100]));
    expect(processed.seriesByChannel.ch02).toEqual(Float32Array.from([0, 10, -10, 0]));
    expect(input.seriesByChannel.ch01).toEqual(Float32Array.from([100_000, 100_010, 99_990, 100_500]));
  });

  it('treats missing baselines and non-finite samples as zero offset', () => {
    const processed = processEegDisplayData({
      x: Float64Array.from([0, 1]),
      seriesByChannel: {
        ch01: Float32Array.from([Number.NaN, Number.POSITIVE_INFINITY]),
      },
    }, {
      clipUv: 100,
      targetPointCount: 100,
    });

    expect(processed.seriesByChannel.ch01).toEqual(Float32Array.from([0, 0]));
  });

  it('uses min max bucket downsampling to preserve spikes', () => {
    const processed = processEegDisplayData({
      x: Float64Array.from([0, 1, 2, 3, 4, 5]),
      seriesByChannel: {
        ch01: Float32Array.from([10, 20, 10, 500, 10, -500]),
      },
      baselineByChannel: {
        ch01: 10,
      },
    }, {
      clipUv: 1_000,
      targetPointCount: 4,
    });

    expect(processed.x).toEqual(Float64Array.from([0, 1, 3, 5]));
    expect(processed.seriesByChannel.ch01).toEqual(Float32Array.from([0, 10, 490, -510]));
  });

  it('merges the per-channel extrema of each bucket into one shared time axis', () => {
    const processed = processEegDisplayData({
      x: Float64Array.from([0, 1, 2, 3]),
      seriesByChannel: {
        ch01: Float32Array.from([4, 1, 4, 9]),
        ch02: Float32Array.from([-7, 1, 8, 1]),
      },
    }, {
      clipUv: 1_000,
      targetPointCount: 2,
    });

    // One bucket: ch01 extrema at indexes 1 (min) and 3 (max), ch02 extrema at
    // 0 (min) and 2 (max) — the union keeps every channel's spike visible on a
    // shared x axis.
    expect(processed.x).toEqual(Float64Array.from([0, 1, 2, 3]));
    expect(processed.seriesByChannel.ch01).toEqual(Float32Array.from([4, 1, 4, 9]));
    expect(processed.seriesByChannel.ch02).toEqual(Float32Array.from([-7, 1, 8, 1]));
  });
});
