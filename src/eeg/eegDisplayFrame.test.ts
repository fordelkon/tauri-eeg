import { describe, expect, it } from 'vitest';
import { processEegDisplayData } from './eegDisplayProcessing';
import { processEegDisplayFrame } from './eegDisplayFrame';
import { toSweepDisplayData, toSweepPageData } from './eegSweepDisplay';
import type { EegChannel, EegDisplayMode, EegDisplaySnapshot, EegTriggerCode } from './types';

const MAX_DISPLAY_POINTS_PER_CHANNEL = 2000;
const TRIGGER_CLASSES: readonly EegTriggerCode[] = [1, 2, 3, 4, 5, 255];

type FrameOptions = {
  timeWindowSeconds: number;
  amplitudeUvPerDiv: number;
  displayMode: EegDisplayMode;
  hostWidth: number;
  /** Panel-latched stream origin; null mirrors an empty buffer. */
  originSeconds: number | null;
};

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

/**
 * Adversarial per-channel signals: smooth mixtures, rail-saturating squares
 * with sub-float32 rail jitter (clip-tie stress), sparse spikes, and samples
 * dropped to NaN/±Infinity by the wire.
 */
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

function makeRandomSnapshot(
  rand: () => number,
  config: {
    sampleCount: number;
    channelCount: number;
    clipLimit: number;
    sampleRateHz: number;
    startSeconds: number;
  },
): EegDisplaySnapshot {
  const channels: EegChannel[] = [];
  const seriesByChannel: Record<string, Float32Array> = {};
  const baselineByChannel: Record<string, number> = {};
  const kinds: readonly SignalKind[] = ['mixed', 'rails', 'spikes', 'dropouts'];

  for (let channelIndex = 0; channelIndex < config.channelCount; channelIndex += 1) {
    const id = `ch${String(channelIndex + 1).padStart(2, '0')}`;
    channels.push({ id, label: id.toUpperCase(), unit: 'uV' });
    seriesByChannel[id] = generateValues(
      kinds[channelIndex % kinds.length],
      rand,
      config.sampleCount,
      config.clipLimit,
    );
    // Realistic EMA-style baselines; some channels deliberately miss theirs.
    if (rand() < 0.8) {
      baselineByChannel[id] = (rand() * 2 - 1) * config.clipLimit * 0.5;
    }
  }

  const spanSeconds = config.sampleCount / config.sampleRateHz;
  const markers = Array.from({ length: Math.floor(rand() * 6) }, () => ({
    // Some land slightly past the cursor so the erase-band filter bites.
    timeSeconds: config.startSeconds + spanSeconds * (rand() * 1.15 - 0.05),
    classId: pick(rand, TRIGGER_CLASSES),
  }));

  const x = new Float64Array(config.sampleCount);
  for (let index = 0; index < config.sampleCount; index += 1) {
    x[index] = config.startSeconds + index / config.sampleRateHz;
  }

  return {
    latestSequence: Math.floor(rand() * 1000),
    x,
    visibleChannels: channels,
    seriesByChannel,
    baselineByChannel,
    markers,
    retainedSampleCount: config.sampleCount,
  };
}

/**
 * Bit-for-bit replica of the PRE-refactor panel frame memo
 * (toSweepDisplayData → processEegDisplayData → toSweepPageData → laneSeries),
 * kept here as the numerical oracle for the fused pipeline.
 */
function legacyPanelFrame(snapshot: EegDisplaySnapshot, options: FrameOptions) {
  const safeTimeWindowSeconds = Math.max(0.1, options.timeWindowSeconds);
  const origin = snapshot.x.length === 0 ? null : options.originSeconds ?? snapshot.x[0];
  const sweep = toSweepDisplayData(snapshot, safeTimeWindowSeconds, origin ?? 0);
  const processed = processEegDisplayData({
    x: sweep.x,
    seriesByChannel: sweep.seriesByChannel,
    baselineByChannel: snapshot.baselineByChannel,
  }, {
    clipUv: options.amplitudeUvPerDiv * 5,
    targetPointCount: Math.min(MAX_DISPLAY_POINTS_PER_CHANNEL, options.hostWidth * 2),
  });
  const laneHeight = options.amplitudeUvPerDiv * 2.5;
  const laneSeries = (values: Float32Array, channelIndex: number) => {
    const laneOffset = -channelIndex * laneHeight;
    const lane = new Float32Array(values.length);
    for (let index = 0; index < values.length; index += 1) {
      lane[index] = values[index] + laneOffset;
    }
    return lane;
  };

  if (options.displayMode === 'sweep') {
    const page = toSweepPageData(processed, safeTimeWindowSeconds, sweep.markers);
    const seriesByChannel: Record<string, Float32Array> = {};
    snapshot.visibleChannels.forEach((channel, channelIndex) => {
      seriesByChannel[channel.id] = laneSeries(
        page.seriesByChannel[channel.id] ?? new Float32Array(0),
        channelIndex,
      );
    });
    return {
      currentCycle: sweep.currentCycle,
      cursorX: page.cursorX,
      x: page.x,
      seriesByChannel,
      markers: page.markers,
    };
  }

  const seriesByChannel: Record<string, Float32Array> = {};
  snapshot.visibleChannels.forEach((channel, channelIndex) => {
    seriesByChannel[channel.id] = laneSeries(
      processed.seriesByChannel[channel.id] ?? new Float32Array(0),
      channelIndex,
    );
  });
  return {
    currentCycle: sweep.currentCycle,
    cursorX: sweep.cursorX,
    x: processed.x,
    seriesByChannel,
    markers: sweep.markers,
  };
}

function modernPanelFrame(snapshot: EegDisplaySnapshot, options: FrameOptions) {
  // Mirrors the panel memo's origin latch: null only for an empty buffer.
  const origin = snapshot.x.length === 0 ? null : options.originSeconds ?? snapshot.x[0];
  return processEegDisplayFrame(snapshot, {
    originSeconds: origin ?? 0,
    timeWindowSeconds: options.timeWindowSeconds,
    clipUv: options.amplitudeUvPerDiv * 5,
    targetPointCount: Math.min(MAX_DISPLAY_POINTS_PER_CHANNEL, options.hostWidth * 2),
    laneHeightUv: options.amplitudeUvPerDiv * 2.5,
    displayMode: options.displayMode,
  });
}

function expectFramesMatch(
  modern: ReturnType<typeof modernPanelFrame>,
  legacy: ReturnType<typeof legacyPanelFrame>,
) {
  expect(modern.currentCycle).toBe(legacy.currentCycle);
  expect(modern.cursorX).toBe(legacy.cursorX);
  expect(modern.x).toEqual(legacy.x);
  expect(Object.keys(modern.seriesByChannel)).toEqual(Object.keys(legacy.seriesByChannel));
  for (const channelId of Object.keys(legacy.seriesByChannel)) {
    expect(modern.seriesByChannel[channelId]).toEqual(legacy.seriesByChannel[channelId]);
  }
  expect(modern.markers).toEqual(legacy.markers);
}

describe('processEegDisplayFrame vs legacy staged pipeline', () => {
  it('produces bit-identical frames across randomized stream configurations', () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      const rand = mulberry32(seed * 7919 + 17);
      const amplitudeUvPerDiv = pick(rand, [7, 20, 50]);
      const config = {
        sampleCount: pick(rand, [0, 1, 2, 31, 997, 4096]),
        channelCount: 1 + Math.floor(rand() * 4),
        clipLimit: amplitudeUvPerDiv * 5,
        sampleRateHz: pick(rand, [250, 1000]),
        startSeconds: pick(rand, [0, 1234.5678]),
      };
      const snapshot = makeRandomSnapshot(rand, config);
      const options: FrameOptions = {
        timeWindowSeconds: pick(rand, [1, 5, 10]),
        amplitudeUvPerDiv,
        displayMode: pick(rand, ['sweep', 'scroll']),
        hostWidth: pick(rand, [400, 1200, 1500]),
        // A latched origin sits at or before the window start — the panel's
        // first-sample latch survives later window slides. Distances up to
        // ~37 s force multi-cycle phase wraps in sweep mode.
        originSeconds: config.sampleCount > 0
          ? config.startSeconds - rand() * 37
          : null,
      };

      expectFramesMatch(
        modernPanelFrame(snapshot, options),
        legacyPanelFrame(snapshot, options),
      );
    }
  });

  it('keeps extrema selection identical when every extremum saturates the clip rails', () => {
    // Clipping collapses distinct raw values onto ±limit, so the index a
    // first-occurrence scan elects depends on comparing exactly the clipped,
    // float32-rounded values — the one case where naive raw-value scanning
    // would drift from the legacy corrected-value scan. Sub-rail jitters
    // probe exactly those ties.
    const amplitudeUvPerDiv = 20;
    const sampleCount = 4096;
    const values = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      const rail = index % 2 === 0 ? 100 : -100;
      values[index] = rail + (index % 4 === 0 ? 0 : ((index % 7) - 3) * 1e-5);
    }
    const snapshot: EegDisplaySnapshot = {
      latestSequence: 1,
      x: Float64Array.from({ length: sampleCount }, (_, index) => index / 250),
      visibleChannels: [{ id: 'ch01', label: 'Ch01', unit: 'uV' }],
      seriesByChannel: { ch01: values },
      baselineByChannel: {},
      markers: [],
      retainedSampleCount: sampleCount,
    };
    const options: FrameOptions = {
      timeWindowSeconds: 10,
      amplitudeUvPerDiv,
      displayMode: 'sweep',
      hostWidth: 400,
      originSeconds: 0,
    };

    const legacy = legacyPanelFrame(snapshot, options);

    // Sanity: the fixture really does produce saturated extrema, so this
    // test exercises the tie path rather than passing vacuously.
    const magnitudes = Array.from(legacy.seriesByChannel.ch01, (value) => Math.abs(value));
    expect(Math.min(...magnitudes)).toBeLessThanOrEqual(100.001);
    expect(Math.max(...magnitudes.filter((value) => value !== 0))).toBeCloseTo(100, 5);

    expectFramesMatch(modernPanelFrame(snapshot, options), legacy);
  });

  it('matches the legacy path on NaN and Infinity samples with missing baselines', () => {
    const sampleCount = 2048;
    const dropouts = new Float32Array(sampleCount);
    const mixture = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      const roll = index % 97;
      dropouts[index] = roll === 0
        ? Number.NaN
        : roll === 1
          ? Number.POSITIVE_INFINITY
          : roll === 2
            ? Number.NEGATIVE_INFINITY
            : (index % 23) - 11;
      mixture[index] = 50 * Math.sin(index * 0.05) + 300;
    }
    const snapshot: EegDisplaySnapshot = {
      latestSequence: 7,
      x: Float64Array.from({ length: sampleCount }, (_, index) => index / 500),
      visibleChannels: [
        { id: 'ch01', label: 'Ch01', unit: 'uV' },
        { id: 'ch02', label: 'Ch02', unit: 'uV' },
      ],
      seriesByChannel: { ch01: dropouts, ch02: mixture },
      // ch02's baseline is deliberately absent — treated as zero offset.
      baselineByChannel: { ch01: 12.5 },
      markers: [],
      retainedSampleCount: sampleCount,
    };

    for (const displayMode of ['sweep', 'scroll'] as const) {
      const options: FrameOptions = {
        timeWindowSeconds: 5,
        amplitudeUvPerDiv: 50,
        displayMode,
        hostWidth: 400,
        originSeconds: 0,
      };
      expectFramesMatch(modernPanelFrame(snapshot, options), legacyPanelFrame(snapshot, options));
    }
  });

  it('matches the legacy path for empty and single-sample snapshots', () => {
    for (const displayMode of ['sweep', 'scroll'] as const) {
      for (const sampleCount of [0, 1]) {
        const rand = mulberry32(displayMode === 'sweep' ? 101 : 202);
        const snapshot = makeRandomSnapshot(rand, {
          sampleCount,
          channelCount: 3,
          clipLimit: 100,
          sampleRateHz: 250,
          startSeconds: 5,
        });
        const options: FrameOptions = {
          timeWindowSeconds: 10,
          amplitudeUvPerDiv: 20,
          displayMode,
          hostWidth: 1200,
          originSeconds: null,
        };
        expectFramesMatch(modernPanelFrame(snapshot, options), legacyPanelFrame(snapshot, options));
      }
    }
  });

  it('reuses scratch internally but never aliases returned buffers across frames', () => {
    const rand = mulberry32(303);
    const snapshot = makeRandomSnapshot(rand, {
      sampleCount: 4096,
      channelCount: 4,
      clipLimit: 100,
      sampleRateHz: 1000,
      startSeconds: 0,
    });
    const options: FrameOptions = {
      timeWindowSeconds: 5,
      amplitudeUvPerDiv: 20,
      displayMode: 'sweep',
      hostWidth: 400,
      originSeconds: 0,
    };

    const first = modernPanelFrame(snapshot, options);
    const pristine = {
      x: first.x.slice(),
      series: Object.fromEntries(
        Object.entries(first.seriesByChannel).map(([id, values]) => [id, values.slice()]),
      ),
    };

    const second = modernPanelFrame(snapshot, options);
    expect(second.x).not.toBe(first.x);
    for (const [id, values] of Object.entries(second.seriesByChannel)) {
      expect(values).not.toBe(first.seriesByChannel[id]);
    }

    // Trashing an earlier frame's outputs must not corrupt the reused
    // internal scratch: a fresh build still reproduces the original data.
    first.x.fill(-1);
    Object.values(first.seriesByChannel).forEach((values) => values.fill(-1));
    const third = modernPanelFrame(snapshot, options);
    expect(third.x).toEqual(pristine.x);
    for (const [id, values] of Object.entries(third.seriesByChannel)) {
      expect(values).toEqual(pristine.series[id]);
    }
  });
});
