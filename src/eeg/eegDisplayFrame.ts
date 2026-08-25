import type { EegDisplayMode, EegDisplaySnapshot, EegMarker } from './types';
import { sweepEraseGapSeconds } from './eegSweepDisplay';

/**
 * Everything one rendered frame needs, consumed by a single fused pass over
 * the raw snapshot (see {@link processEegDisplayFrame}).
 */
export type EegDisplayFrameOptions = {
  /** Stream origin latched by the panel; sample times become seconds since it. */
  originSeconds: number;
  timeWindowSeconds: number;
  clipUv: number;
  targetPointCount: number;
  /** Vertical size of one lane; channel series are offset by -laneIndex * this. */
  laneHeightUv: number;
  displayMode: EegDisplayMode;
};

export type EegDisplayFrame = {
  currentCycle: number;
  cursorX: number;
  x: Float64Array;
  seriesByChannel: Record<string, Float32Array>;
  markers: EegMarker[];
};

/**
 * Upper bound on the panel's decimation budget; the effective budget scales
 * down with plot width (two points per CSS pixel). Lives here so the panel
 * and the snapshot-taking session context share one number — the ring only
 * pre-decimates when it knows the exact budget the frame builder will use.
 */
export const MAX_DISPLAY_POINTS_PER_CHANNEL = 2000;

/**
 * Builds one renderable frame — uPlot x axis, per-channel traces, sweep
 * cursor/markers — from a raw display snapshot in two allocation-light
 * stages:
 *
 * 1. Index-only min/max bucket decimation over the RAW channel values. No
 *    per-channel full-window array is ever materialized; only the surviving
 *    sample indexes (≤ a few thousand) are recorded.
 * 2. A single fused gather over the surviving indexes that applies baseline
 *    correction, clipping, phase fold (sweep mode), cycle rotation, and lane
 *    offset in one arithmetic expression per output point.
 *
 * Why decimating raw values first is numerically equivalent to the legacy
 * correct-everything-then-decimate pipeline
 * (toSweepDisplayData → processEegDisplayData → toSweepPageData → laneSeries):
 *
 * 1. Baseline correction subtracts a constant: v ↦ v − b. A translation is a
 *    strictly order-preserving bijection on the reals, so every pairwise
 *    comparison outcome is unchanged — argmin, argmax, and their
 *    first-occurrence tie-breaking select the same indexes before and after
 *    the shift. Decimation therefore never needs the corrected values.
 * 2. Clipping is merely WEAKLY monotone: samples past ±limit collapse onto
 *    the rails, so it can merge distinct raw values into ties and shift which
 *    tied index a first-occurrence scan elects. Rather than assume ties away,
 *    the scan below applies the exact clip to each raw sample on the fly and
 *    compares those values — reproducing the legacy comparison sequence
 *    instruction for instruction, so the selected indexes match the
 *    full-correction path bit-for-bit even when every extremum sits on a
 *    rail. Math.fround mirrors the Float32Array storage the legacy path
 *    compared (and drew) through, keeping the compared bits identical.
 * 3. Correction, clip, phase fold, rotation, and lane offset are pointwise
 *    maps of a single sample (rotation is a pure permutation of the selected
 *    sequence), so fusing them into one gather over the surviving indexes
 *    cannot interact with the selection step.
 * 4. The ring-buffer snapshot layer runs the SAME selection over its circular
 *    stores via selectDisplayIndexesFromInterval instead of copying the whole
 *    window out first. Its accessor returns the identical Float32 bits (typed
 *    -array reads preserve bits), baselines, and clip limit the full-window
 *    path would see, so by 1–2 it elects exactly the survivor set this frame
 *    builder would pick itself. The snapshot records those parameters
 *    (decimatedFor) and the undecimated tail time (latestTimeSeconds); on an
 *    exact match stage 1 degrades to identity selection and stages below
 *    gather from bit-identical copies in ascending order, so the frame equals
 *    the full-copy pipeline bit-for-bit while moving only survivors.
 *
 * Steady-state cost is O(selectedPoints × channels) per frame — the freshly
 * allocated output arrays uPlot retains — instead of the legacy
 * O(windowSamples × channels) intermediate garbage (~400 KB per frame at
 * 1000 Hz × 10 s × 4 ch, megabytes at 30 s × 16 ch).
 */
export function processEegDisplayFrame(
  snapshot: EegDisplaySnapshot,
  options: EegDisplayFrameOptions,
): EegDisplayFrame {
  const safeWindowSeconds = Math.max(0.1, options.timeWindowSeconds);
  const originSeconds = options.originSeconds;
  const clipLimit = Math.max(1, options.clipUv);
  const sweepMode = options.displayMode === 'sweep';
  const sourceX = snapshot.x;
  const sampleCount = sourceX.length;

  if (sampleCount === 0) {
    const emptySeries: Record<string, Float32Array> = {};
    for (const channel of snapshot.visibleChannels) {
      emptySeries[channel.id] = new Float32Array(0);
    }
    return {
      currentCycle: 0,
      cursorX: 0,
      x: new Float64Array(0),
      seriesByChannel: emptySeries,
      // An empty window still maps (and, on a sweep page, erase-filters)
      // markers exactly like the legacy staged pipeline.
      markers: sweepMode
        ? filterSweepMarkers(snapshot.markers, 0, originSeconds, safeWindowSeconds)
        : snapshot.markers.map((marker) => ({
          ...marker,
          timeSeconds: Math.max(0, marker.timeSeconds - originSeconds),
        })),
    };
  }

  // Cursor/cycle derive from the undecimated tail, exactly like the legacy
  // toSweepDisplayData bookkeeping. A pre-decimated snapshot stops its x axis
  // at the last SURVIVING sample (the true newest sample need not be a bucket
  // extremum), so it carries the undecimated tail alongside instead.
  const latestTimeSeconds = snapshot.latestTimeSeconds ?? sourceX[sampleCount - 1];
  const latestRelativeSeconds = Math.max(0, latestTimeSeconds - originSeconds);
  const currentCycle = Math.floor(latestRelativeSeconds / safeWindowSeconds);

  // Stage 1: index-only min/max decimation on raw values (zero value-array
  // allocation; see the equivalence argument in the function comment above).
  // A snapshot already decimated for exactly these parameters selects
  // everything: its survivor set IS the one this scan would elect from the
  // full window (shared bucket geometry, baselines, and clip limit), so
  // running the buckets again would compound the loss instead of repeating
  // it. Any other mismatch falls through to a plain re-selection.
  const preselected = snapshot.decimatedFor !== undefined
    && snapshot.decimatedFor.targetPointCount === options.targetPointCount
    && snapshot.decimatedFor.clipLimit === clipLimit;
  const selectedCount = selectDisplayIndexes(
    snapshot,
    clipLimit,
    preselected ? Number.POSITIVE_INFINITY : options.targetPointCount,
  );

  // Sweep pages rotate at the first phase descent so x stays ascending for
  // uPlot; scroll windows and pre-wrap streams keep chronological order.
  let rotationStart = -1;
  if (sweepMode) {
    let previousPhase = selectedPhase(sourceX, selectedIndexes[0], originSeconds, safeWindowSeconds);
    for (let k = 1; k < selectedCount; k += 1) {
      const phase = selectedPhase(sourceX, selectedIndexes[k], originSeconds, safeWindowSeconds);
      if (phase < previousPhase) {
        rotationStart = k;
        break;
      }
      previousPhase = phase;
    }
  }

  // Stage 2a: plot x axis — relative seconds (scroll) or phase within the
  // page (sweep) — written directly into rotated position. Two contiguous
  // ranges replace a per-point modulo of the destination index.
  const start = rotationStart === -1 ? 0 : rotationStart;
  const x = new Float64Array(selectedCount);
  for (let range = 0; range < 2; range += 1) {
    const from = range === 0 ? start : 0;
    const to = range === 0 ? selectedCount : start;
    let position = range === 0 ? 0 : selectedCount - start;
    for (let k = from; k < to; k += 1, position += 1) {
      const relative = Math.max(0, sourceX[selectedIndexes[k]] - originSeconds);
      x[position] = sweepMode ? relative % safeWindowSeconds : relative;
    }
  }

  const cursorX = sweepMode
    ? selectedPhase(sourceX, selectedIndexes[selectedCount - 1], originSeconds, safeWindowSeconds)
    : latestRelativeSeconds;

  // Stage 2b: fused gather — correct + clip + lane offset (+ rotation) per
  // surviving point, straight into the output buffer uPlot retains. Channels
  // are expected to cover the whole window (ring-buffer contract); anything
  // missing renders as an empty trace like the legacy panel's fallback.
  const seriesByChannel: Record<string, Float32Array> = {};
  for (let laneIndex = 0; laneIndex < snapshot.visibleChannels.length; laneIndex += 1) {
    const channel = snapshot.visibleChannels[laneIndex];
    const values = snapshot.seriesByChannel[channel.id];
    if (!values || values.length === 0) {
      seriesByChannel[channel.id] = new Float32Array(0);
      continue;
    }
    const baseline = snapshot.baselineByChannel?.[channel.id] ?? 0;
    const laneOffset = -laneIndex * options.laneHeightUv;
    const lane = new Float32Array(selectedCount);
    for (let range = 0; range < 2; range += 1) {
      const from = range === 0 ? start : 0;
      const to = range === 0 ? selectedCount : start;
      let position = range === 0 ? 0 : selectedCount - start;
      for (let k = from; k < to; k += 1, position += 1) {
        lane[position] = displayValueAt(values, selectedIndexes[k], baseline, clipLimit) + laneOffset;
      }
    }
    seriesByChannel[channel.id] = lane;
  }

  const markers = sweepMode
    ? filterSweepMarkers(snapshot.markers, cursorX, originSeconds, safeWindowSeconds)
    : snapshot.markers.map((marker) => ({
      ...marker,
      timeSeconds: Math.max(0, marker.timeSeconds - originSeconds),
    }));

  return {
    currentCycle,
    cursorX,
    x,
    seriesByChannel,
    markers,
  };
}

/*
 * Per-frame scratch, grown to the high-water mark and reused across frames so
 * steady-state rendering allocates nothing here. Sharing it at module level
 * is safe because the pipeline is synchronous, single-threaded, and free of
 * re-entrancy — no callbacks or awaits between writing and consuming the
 * scratch — so interleaved calls from multiple panel instances each complete
 * their whole scan-gather before the next one starts. Frame OUTPUTS above are
 * freshly allocated, so callers (and uPlot) may retain them across frames.
 */
let selectedIndexes = new Int32Array(0);
let bucketExtrema = new Int32Array(0);

function ensureSelectedCapacity(capacity: number) {
  if (selectedIndexes.length < capacity) {
    selectedIndexes = new Int32Array(capacity);
  }
}

function ensureExtremaCapacity(capacity: number) {
  if (bucketExtrema.length < capacity) {
    bucketExtrema = new Int32Array(capacity);
  }
}

/** Grows the module scratch to `capacity` and hands it back for writing. */
function selectedScratchFor(capacity: number): Int32Array {
  ensureSelectedCapacity(capacity);
  return selectedIndexes;
}

/**
 * Baseline-shifted, clipped display value of one raw sample, rounded to the
 * Float32 precision the legacy pipeline stored its corrected arrays at (and
 * therefore compared and drew through). Non-finite samples render as 0 so
 * neither the extrema scan nor the canvas layout can be poisoned by NaN.
 */
function displayValueAt(values: Float32Array, index: number, baseline: number, limit: number) {
  const shifted = values[index] - baseline;
  if (!Number.isFinite(shifted)) {
    return 0;
  }
  return Math.fround(shifted < -limit ? -limit : shifted > limit ? limit : shifted);
}

function selectedPhase(
  sourceX: Float64Array,
  selectedIndex: number,
  originSeconds: number,
  safeWindowSeconds: number,
) {
  return Math.max(0, sourceX[selectedIndex] - originSeconds) % safeWindowSeconds;
}

/**
 * Raw-value access to one display interval, decoupled from where the samples
 * physically live. The fused frame path reads a plain snapshot (contiguous
 * arrays); the ring buffer reads straight out of its circular stores through
 * the same interface, so both layers run ONE bucket implementation and can
 * never drift into compounding double-decimation distortion.
 */
export type EegIntervalSampleSource = {
  /** Logical sample count of the interval. */
  sampleCount: number;
  /**
   * Raw stored value (Float32 bits) of channel slot `slot` at logical offset
   * `index` ∈ [0, sampleCount). Slot order matches {@link baselines}.
   */
  valueAt(slot: number, index: number): number;
  /**
   * Baseline subtracted before clipping, per slot — the same effective values
   * a snapshot's baselineByChannel carries (missing entries read as zero).
   */
  baselines: readonly number[];
};

/**
 * Upper bound on how many indexes one selection can emit, so callers owning
 * their scratch can size it before calling
 * {@link selectDisplayIndexesFromInterval}. A window that fits the budget
 * keeps every sample; otherwise each bucket contributes at most two extrema
 * per channel slot.
 */
export function displaySelectionBound(
  sampleCount: number,
  slotCount: number,
  targetPointCount: number,
): number {
  if (sampleCount <= targetPointCount || targetPointCount <= 0) {
    return sampleCount;
  }
  const bucketSize = Math.max(1, Math.ceil(sampleCount / Math.max(1, targetPointCount / 2)));
  const bucketCount = Math.ceil(sampleCount / bucketSize);
  return Math.min(sampleCount, bucketCount * 2 * slotCount);
}

/**
 * Min/max bucket decimation over RAW values read through an interval source,
 * recording the surviving LOGICAL indexes only. Buckets are disjoint and
 * visited in order, so per-bucket ordering is enough; the union of every
 * channel's extrema survives decimation, keeping the spikes of all channels
 * visible on one shared time axis. Returns the selected count; ascending
 * indexes land in `out`, or in the module scratch when omitted (synchronous,
 * single-threaded consumption only — see the scratch note above). A window
 * that already fits the budget (or a non-positive budget) selects everything.
 *
 * This is the single source of truth for the bucket geometry (including the
 * legacy downsampleMinMax targetPointCount/2 sizing): both frame stages and
 * the ring-buffer snapshot layer select through it, which is what makes a
 * pre-decimated snapshot's survivor set provably identical to the set this
 * frame builder would elect itself.
 */
export function selectDisplayIndexesFromInterval(
  source: EegIntervalSampleSource,
  clipLimit: number,
  targetPointCount: number,
  out?: Int32Array,
): number {
  const length = source.sampleCount;
  const slotCount = source.baselines.length;
  const destinations = out ?? selectedScratchFor(length);

  if (length <= targetPointCount || targetPointCount <= 0) {
    for (let index = 0; index < length; index += 1) {
      destinations[index] = index;
    }
    return length;
  }

  const bucketSize = Math.max(1, Math.ceil(length / Math.max(1, targetPointCount / 2)));
  if (!out) {
    // Every bucket contributes at most two extrema per channel.
    ensureSelectedCapacity(displaySelectionBound(length, slotCount, targetPointCount));
  }
  ensureExtremaCapacity(slotCount * 2);

  let selectedCount = 0;
  for (let bucketStart = 0; bucketStart < length; bucketStart += bucketSize) {
    const bucketEnd = Math.min(length, bucketStart + bucketSize);
    let candidateCount = 0;

    for (let slot = 0; slot < slotCount; slot += 1) {
      const baseline = source.baselines[slot];
      let minIndex = bucketStart;
      let maxIndex = bucketStart;
      let minValue = sourceDisplayValueAt(source, slot, minIndex, baseline, clipLimit);
      let maxValue = minValue;
      for (let index = bucketStart + 1; index < bucketEnd; index += 1) {
        const value = sourceDisplayValueAt(source, slot, index, baseline, clipLimit);
        if (value < minValue) {
          minValue = value;
          minIndex = index;
        }
        if (value > maxValue) {
          maxValue = value;
          maxIndex = index;
        }
      }
      bucketExtrema[candidateCount] = minIndex;
      candidateCount += 1;
      bucketExtrema[candidateCount] = maxIndex;
      candidateCount += 1;
    }

    insertionSort(bucketExtrema, candidateCount);
    let previous = -1;
    for (let index = 0; index < candidateCount; index += 1) {
      const candidate = bucketExtrema[index];
      if (candidate !== previous) {
        destinations[selectedCount] = candidate;
        selectedCount += 1;
        previous = candidate;
      }
    }
  }

  return selectedCount;
}

/** Module-scratch flavor of {@link displayValueAt} for interval sources. */
function sourceDisplayValueAt(
  source: EegIntervalSampleSource,
  slot: number,
  index: number,
  baseline: number,
  limit: number,
) {
  const shifted = source.valueAt(slot, index) - baseline;
  if (!Number.isFinite(shifted)) {
    return 0;
  }
  return Math.fround(shifted < -limit ? -limit : shifted > limit ? limit : shifted);
}

function selectDisplayIndexes(
  snapshot: EegDisplaySnapshot,
  clipLimit: number,
  targetPointCount: number,
): number {
  const channelIds = Object.keys(snapshot.seriesByChannel);
  const stores = channelIds.map((channelId) => snapshot.seriesByChannel[channelId]);
  const baselines = channelIds.map((channelId) => snapshot.baselineByChannel?.[channelId] ?? 0);
  return selectDisplayIndexesFromInterval(
    {
      sampleCount: snapshot.x.length,
      valueAt: (slot, index) => stores[slot][index],
      baselines,
    },
    clipLimit,
    targetPointCount,
  );
}

// Insertion sort on the ≤2-per-channel extrema indexes: faster than a Set plus
// Array.prototype.sort for these tiny buckets and allocates nothing.
function insertionSort(indexes: Int32Array, count: number) {
  for (let i = 1; i < count; i += 1) {
    const value = indexes[i];
    let j = i - 1;
    while (j >= 0 && indexes[j] > value) {
      indexes[j + 1] = indexes[j];
      j -= 1;
    }
    indexes[j + 1] = value;
  }
}

/**
 * Phase-mapped markers for a sweep page; those inside the erase band are
 * dropped (they are being overwritten right now), the rest stay visible until
 * the band reaches them. The fold mirrors the legacy two-stage pipeline —
 * seconds-since-origin first, page phase second — so the modulo must see the
 * same relative input as the x axis, not absolute time.
 */
function filterSweepMarkers(
  markers: EegMarker[],
  cursorX: number,
  originSeconds: number,
  safeWindowSeconds: number,
): EegMarker[] {
  const eraseGapSeconds = sweepEraseGapSeconds(safeWindowSeconds);
  return markers
    .map((marker) => ({
      ...marker,
      timeSeconds: Math.max(0, marker.timeSeconds - originSeconds) % safeWindowSeconds,
    }))
    .filter((marker) => {
      const distanceAhead = (marker.timeSeconds - cursorX + safeWindowSeconds) % safeWindowSeconds;
      return distanceAhead > eraseGapSeconds;
    });
}
