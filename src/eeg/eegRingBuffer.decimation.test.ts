import { describe, expect, it } from 'vitest';
import { DEFAULT_EEG_CHANNELS } from './channels';
import { MAX_DISPLAY_POINTS_PER_CHANNEL, processEegDisplayFrame } from './eegDisplayFrame';
import { EegRingBuffer } from './eegRingBuffer';
import type {
  EegChannel,
  EegDecodedSampleBlock,
  EegDisplayMode,
} from './types';

/**
 * Oracle tests for the ring's snapshot-layer pre-decimation: the decimated
 * snapshot fed through processEegDisplayFrame must reproduce — bit for bit —
 * the frame built from the legacy full-window-copy snapshot of the SAME ring
 * state, because the shared selector (selectDisplayIndexesFromInterval) is
 * what makes the two survivor sets provably identical.
 */

const TRIGGER_CLASSES = [1, 2, 3, 4, 255] as const;

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, choices: readonly T[]): T {
  return choices[Math.floor(rand() * choices.length)];
}

type SignalKind = 'mixed' | 'rails' | 'spikes' | 'dropouts';

/** Same adversarial families as the frame-builder oracle tests. */
function generateValues(
  kind: SignalKind,
  rand: () => number,
  sampleCount: number,
  clipLimit: number,
): Float32Array {
  const values = new Float32Array(sampleCount);
  let blockValue = clipLimit * 2;
  let blockRemaining = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    if (kind === 'rails') {
      if (blockRemaining === 0) {
        blockValue = (rand() < 0.5 ? -1 : 1) * clipLimit * (1 + rand() * 2);
        blockRemaining = 2 + Math.floor(rand() * 8);
      }
      values[index] = blockValue + (rand() - 0.5) * 1e-5;
      blockRemaining -= 1;
    } else if (kind === 'spikes') {
      values[index] = rand() < 0.02
        ? (rand() < 0.5 ? -1 : 1) * clipLimit * (1 + rand() * 4)
        : (rand() * 2 - 1) * 10;
    } else if (kind === 'dropouts') {
      const roll = rand();
      values[index] = roll < 0.01
        ? Number.NaN
        : roll < 0.015
          ? Number.POSITIVE_INFINITY
          : roll < 0.02
            ? Number.NEGATIVE_INFINITY
            : (rand() * 2 - 1) * clipLimit * 1.5;
    } else {
      values[index] = (
        40 * Math.sin(index * 0.03)
        + (rand() * 2 - 1) * 15
        + (rand() < 0.5 ? -1 : 1) * clipLimit * 0.8
      );
    }
  }
  return values;
}

type StreamFixture = {
  buffer: EegRingBuffer;
  channels: EegChannel[];
  /** Absolute time of the newest retained sample. */
  latestTimeSeconds: number;
};

/**
 * Streams contiguous blocks into a fresh ring, forcing circular wraparound
 * (head far from 0), sparse trigger markers, and non-retained history past
 * the capacity cap.
 */
function streamRandomFixture(
  rand: () => number,
  config: {
    sampleRateHz: number;
    blockSampleCount: number;
    blockCount: number;
    channelCount: number;
    maxWindowSeconds: number;
    clipLimit: number;
    startSeconds: number;
  },
): StreamFixture {
  const channels = DEFAULT_EEG_CHANNELS.slice(0, config.channelCount);
  const buffer = new EegRingBuffer(channels, config.sampleRateHz, config.maxWindowSeconds);

  const kinds: readonly SignalKind[] = ['mixed', 'rails', 'spikes', 'dropouts'];
  const totalSamples = config.blockSampleCount * config.blockCount;
  const channelValues = channels.map((_, channelIndex) => generateValues(
    kinds[channelIndex % kinds.length],
    rand,
    totalSamples,
    config.clipLimit,
  ));

  const blockSeconds = config.blockSampleCount / config.sampleRateHz;
  for (let block = 0; block < config.blockCount; block += 1) {
    const from = block * config.blockSampleCount;
    const payload: EegDecodedSampleBlock = {
      sequence: block + 1,
      sampleRateHz: config.sampleRateHz,
      startedAtMs: Math.round((config.startSeconds + block * blockSeconds) * 1000),
      // Sparse triggers near window edges exercise marker survival too.
      triggerClass: rand() < 0.12 ? pick(rand, TRIGGER_CLASSES) : null,
      samples: channelValues.map((values) => values.slice(
        from,
        from + config.blockSampleCount,
      )),
    };
    buffer.appendPayload(payload);
  }

  return {
    buffer,
    channels,
    latestTimeSeconds: config.startSeconds + (totalSamples - 1) / config.sampleRateHz,
  };
}

function expectFramesBitEqual(
  actual: ReturnType<typeof processEegDisplayFrame>,
  expected: ReturnType<typeof processEegDisplayFrame>,
) {
  expect(actual.currentCycle).toBe(expected.currentCycle);
  expect(actual.cursorX).toBe(expected.cursorX);
  expect(actual.x).toEqual(expected.x);
  expect(Object.keys(actual.seriesByChannel)).toEqual(Object.keys(expected.seriesByChannel));
  for (const channelId of Object.keys(expected.seriesByChannel)) {
    expect(actual.seriesByChannel[channelId]).toEqual(expected.seriesByChannel[channelId]);
  }
  expect(actual.markers).toEqual(expected.markers);
}

describe('EegRingBuffer snapshot pre-decimation vs full-copy oracle', () => {
  it('reproduces full-copy frames bit-for-bit across randomized streams', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const rand = mulberry32(seed * 104_729 + 5);
      const sampleRateHz = pick(rand, [250, 1000]);
      const amplitudeUvPerDiv = pick(rand, [7, 20, 50]);
      const clipLimit = amplitudeUvPerDiv * 5;
      const maxWindowSeconds = 10;
      const fixture = streamRandomFixture(rand, {
        sampleRateHz,
        blockSampleCount: pick(rand, [20, 50, 160]),
        blockCount: pick(rand, [40, 90, 200]),
        channelCount: 1 + Math.floor(rand() * 4),
        maxWindowSeconds,
        clipLimit,
        // Half-second precision keeps every startedAtMs an exact integer, so
        // sample times stay strictly increasing across block boundaries.
        startSeconds: pick(rand, [0, 1234.5]),
      });
      // A visible-id list that sometimes hides channels or names an unknown id.
      const visibleIds = new Set(
        fixture.channels
          .filter(() => rand() < 0.75)
          .map((channel) => channel.id),
      );
      if (visibleIds.size === 0 || rand() < 0.25) {
        visibleIds.add(fixture.channels[0].id);
      }
      if (rand() < 0.2) {
        visibleIds.add('ch99');
      }

      const timeWindowSeconds = pick(rand, [1, 5, 10]);
      const targetPointCount = pick(rand, [400, 800, 1500]);
      const clipUv = amplitudeUvPerDiv * 5;
      const displayMode: EegDisplayMode = pick(rand, ['sweep', 'scroll']);
      const originSeconds = fixture.latestTimeSeconds - rand() * 40;

      const fullSnapshot = fixture.buffer.toDisplayData(visibleIds, timeWindowSeconds);
      const preSnapshot = fixture.buffer.toDisplayData(visibleIds, timeWindowSeconds, {
        targetPointCount,
        clipUv,
      });

      const sampleCount = fullSnapshot.x.length;
      if (sampleCount > targetPointCount) {
        // The gate must fire and record exactly the parameters the frame
        // builder will recognize (post-clamp limit included).
        expect(preSnapshot.decimatedFor).toEqual({
          targetPointCount,
          clipLimit: Math.max(1, clipUv),
        });
        expect(preSnapshot.x.length).toBeLessThan(sampleCount);
        // Same physical slot the full copy's last element was read from, so
        // the tail time must match bit for bit (an independently computed
        // value would drift by float association instead).
        expect(preSnapshot.latestTimeSeconds)
          .toBe(fullSnapshot.x[sampleCount - 1]);
      } else {
        expect(preSnapshot.decimatedFor).toBeUndefined();
      }

      // Both layers must publish identical baselines/markers regardless of
      // which copy path ran, and x must stay strictly chronological.
      expect(preSnapshot.baselineByChannel).toEqual(fullSnapshot.baselineByChannel);
      expect(preSnapshot.markers).toEqual(fullSnapshot.markers);
      expect(preSnapshot.visibleChannels).toEqual(fullSnapshot.visibleChannels);
      for (let index = 1; index < preSnapshot.x.length; index += 1) {
        expect(preSnapshot.x[index]).toBeGreaterThan(preSnapshot.x[index - 1]);
      }

      const frameOptions = {
        originSeconds,
        timeWindowSeconds,
        clipUv,
        targetPointCount: Math.min(MAX_DISPLAY_POINTS_PER_CHANNEL, targetPointCount),
        laneHeightUv: amplitudeUvPerDiv * 2.5,
        displayMode,
      };
      expectFramesBitEqual(
        processEegDisplayFrame(preSnapshot, frameOptions),
        processEegDisplayFrame(fullSnapshot, frameOptions),
      );
    }
  });

  it('elects identical survivors when the ring seam falls inside a bucket', () => {
    // Capacity ceil(250 Hz * 1 s * 1.5) = 375; streaming 1000 samples leaves
    // head = (1000 - 375) % 375 = 250. A window wide enough to span the whole
    // retention keeps every retained sample visible, so the interval wraps at
    // logical offset 125 — deliberately inside bucket [120, 132) for a budget
    // of 64 (bucketSize ceil(375 / 32) = 12).
    const sampleRateHz = 250;
    const channels = DEFAULT_EEG_CHANNELS.slice(0, 2);
    const buffer = new EegRingBuffer(channels, sampleRateHz, 1);
    const totalSamples = 1000;
    const values = channels.map(() => new Float32Array(totalSamples));
    for (let index = 0; index < totalSamples; index += 1) {
      // Well-separated extrema so every bucket has unambiguous winners.
      values.forEach((channel, channelIndex) => {
        channel[index] = (index % 37 === 0 ? 90 : 0)
          + (index % 53 === 0 ? -80 : 0)
          + ((index * (channelIndex + 3)) % 11) - 5;
      });
    }
    for (let block = 0; block < totalSamples / 50; block += 1) {
      buffer.appendPayload({
        sequence: block + 1,
        sampleRateHz,
        startedAtMs: block * 200,
        triggerClass: null,
        samples: values.map((channel) => channel.slice(block * 50, block * 50 + 50)),
      });
    }

    const visibleIds = new Set(['ch01', 'ch02']);
    const fullSnapshot = buffer.toDisplayData(visibleIds, 10);
    expect(fullSnapshot.x.length).toBe(375);
    const preSnapshot = buffer.toDisplayData(visibleIds, 10, {
      targetPointCount: 64,
      clipUv: 100,
    });

    const frameOptions = {
      originSeconds: 0,
      timeWindowSeconds: 10,
      clipUv: 100,
      targetPointCount: 64,
      laneHeightUv: 50,
      displayMode: 'scroll' as const,
    };
    expectFramesBitEqual(
      processEegDisplayFrame(preSnapshot, frameOptions),
      processEegDisplayFrame(fullSnapshot, frameOptions),
    );
  });

  it('keeps the true tail time when buckets elect indexes before the newest sample', () => {
    // A perfectly flat tail makes every sample in its bucket a tie, so the
    // bucket elects its FIRST index and the decimated x axis legitimately
    // stops before the newest sample — cursor and cycle must still derive
    // from the real tail via latestTimeSeconds. totalSamples is chosen so the
    // final bucket holds many samples (bucketSize ceil(2516/150) = 17, last
    // bucket [2499, 2516)) rather than degenerating into a singleton that
    // would always elect the newest sample.
    const sampleRateHz = 250;
    const channels = DEFAULT_EEG_CHANNELS.slice(0, 1);
    const buffer = new EegRingBuffer(channels, sampleRateHz, 10);
    const totalSamples = 2516;
    const values = new Float32Array(totalSamples);
    for (let index = 0; index < totalSamples; index += 1) {
      values[index] = index < totalSamples - 600 ? 30 * Math.sin(index * 0.05) : 42;
    }
    for (let block = 0; block < Math.ceil(totalSamples / 100); block += 1) {
      buffer.appendPayload({
        sequence: block + 1,
        sampleRateHz,
        startedAtMs: block * 400,
        triggerClass: null,
        samples: [values.slice(block * 100, block * 100 + 100)],
      });
    }

    const visibleIds = new Set(['ch01']);
    // A 20 s window spans the whole retention (the 10 s cap would clip the
    // interval head and change the bucket geometry the comment above fixes).
    const timeWindowSeconds = 20;
    const fullSnapshot = buffer.toDisplayData(visibleIds, timeWindowSeconds);
    const preSnapshot = buffer.toDisplayData(visibleIds, timeWindowSeconds, {
      targetPointCount: 300,
      clipUv: 200,
    });

    const newestTime = fullSnapshot.x[fullSnapshot.x.length - 1];
    expect(preSnapshot.decimatedFor).toBeDefined();
    expect(preSnapshot.x[preSnapshot.x.length - 1]).toBeLessThan(newestTime);
    expect(preSnapshot.latestTimeSeconds).toBe(newestTime);

    const frameOptions = {
      originSeconds: 0,
      timeWindowSeconds,
      clipUv: 200,
      targetPointCount: 300,
      laneHeightUv: 50,
      displayMode: 'scroll' as const,
    };
    const fullFrame = processEegDisplayFrame(fullSnapshot, frameOptions);
    const preFrame = processEegDisplayFrame(preSnapshot, frameOptions);
    // Cursor/cycle come from the undecimated tail, not the last survivor.
    expect(preFrame.cursorX).toBe(fullFrame.cursorX);
    expect(preFrame.currentCycle).toBe(fullFrame.currentCycle);
    expectFramesBitEqual(preFrame, fullFrame);
  });

  it('degrades to an exact full copy when the window fits the point budget', () => {
    const sampleRateHz = 250;
    const channels = DEFAULT_EEG_CHANNELS.slice(0, 2);
    const buffer = new EegRingBuffer(channels, sampleRateHz, 10);
    const totalSamples = 400;
    const values = channels.map(() => new Float32Array(totalSamples));
    for (let index = 0; index < totalSamples; index += 1) {
      values.forEach((channel, channelIndex) => {
        channel[index] = (index % 23 - 11) * (channelIndex + 1);
      });
    }
    buffer.appendPayload({
      sequence: 1,
      sampleRateHz,
      startedAtMs: 0,
      triggerClass: 255,
      samples: values.map((channel) => channel.slice()),
    });

    const visibleIds = new Set(['ch01', 'ch02']);
    const fullSnapshot = buffer.toDisplayData(visibleIds, 10);
    const preSnapshot = buffer.toDisplayData(visibleIds, 10, {
      targetPointCount: 800,
      clipUv: 100,
    });

    expect(preSnapshot.decimatedFor).toBeUndefined();
    expect(preSnapshot.x).toEqual(fullSnapshot.x);
    for (const channelId of visibleIds) {
      expect(preSnapshot.seriesByChannel[channelId])
        .toEqual(fullSnapshot.seriesByChannel[channelId]);
    }
  });

  it('matches the full copy on an empty buffer', () => {
    const channels = DEFAULT_EEG_CHANNELS.slice(0, 2);
    const buffer = new EegRingBuffer(channels, 250, 10);
    const visibleIds = new Set(['ch01']);

    const fullSnapshot = buffer.toDisplayData(visibleIds, 10);
    const preSnapshot = buffer.toDisplayData(visibleIds, 10, {
      targetPointCount: 500,
      clipUv: 100,
    });

    expect(preSnapshot.decimatedFor).toBeUndefined();
    expect(preSnapshot.x.length).toBe(0);
    expectFramesBitEqual(
      processEegDisplayFrame(preSnapshot, {
        originSeconds: 0,
        timeWindowSeconds: 10,
        clipUv: 100,
        targetPointCount: 500,
        laneHeightUv: 50,
        displayMode: 'sweep',
      }),
      processEegDisplayFrame(fullSnapshot, {
        originSeconds: 0,
        timeWindowSeconds: 10,
        clipUv: 100,
        targetPointCount: 500,
        laneHeightUv: 50,
        displayMode: 'sweep',
      }),
    );
  });
});
