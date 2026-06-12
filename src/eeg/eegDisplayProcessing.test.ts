import { describe, expect, it } from 'vitest';
import { processEegDisplayData } from './eegDisplayProcessing';

describe('processEegDisplayData', () => {
  it('removes per-channel DC offset and clips values for display only', () => {
    const input = {
      x: [0, 1, 2, 3],
      seriesByChannel: {
        ch01: [100_000, 100_010, 99_990, 100_500],
        ch02: [-207_320, -207_310, -207_330, -207_320],
      },
    };

    const processed = processEegDisplayData(input, {
      clipUv: 100,
      targetPointCount: 100,
    });

    expect(processed.x).toEqual([0, 1, 2, 3]);
    expect(processed.seriesByChannel.ch01).toEqual([0, 10, -10, 100]);
    expect(processed.seriesByChannel.ch02).toEqual([0, 10, -10, 0]);
    expect(input.seriesByChannel.ch01).toEqual([100_000, 100_010, 99_990, 100_500]);
  });

  it('uses min max bucket downsampling to preserve spikes', () => {
    const processed = processEegDisplayData({
      x: [0, 1, 2, 3, 4, 5],
      seriesByChannel: {
        ch01: [10, 20, 10, 500, 10, -500],
      },
    }, {
      clipUv: 1_000,
      targetPointCount: 4,
    });

    expect(processed.x).toEqual([0, 1, 3, 5]);
    expect(processed.seriesByChannel.ch01).toEqual([0, 10, 490, -510]);
  });
});
