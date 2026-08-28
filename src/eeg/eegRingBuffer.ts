import type {
  EegChannel,
  EegDecodedSampleBlock,
  EegDisplaySnapshot,
  EegMarker,
  EegTriggerCode,
} from './types';
import { displaySelectionBound, selectDisplayIndexesFromInterval } from './eegDisplayFrame';

const CAP_WINDOW_MULTIPLIER = 1.5;
const EMA_TIME_CONSTANT_SECONDS = 1;

const MARKER_CLASSES: readonly EegTriggerCode[] = [1, 2, 3, 4, 5, 255];

/**
 * Copies `count` logical entries starting at physical index `physicalStart`
 * (which may wrap past the end of the backing store) into `target`.
 */
function copyWrappedRange(
  target: Float32Array | Float64Array,
  source: Float32Array | Float64Array,
  physicalStart: number,
  count: number,
  capacity: number,
) {
  const first = Math.min(count, capacity - physicalStart);
  if (first > 0) {
    target.set(source.subarray(physicalStart, physicalStart + first), 0);
  }
  if (first < count) {
    target.set(source.subarray(0, count - first), first);
  }
}

/**
 * Frame-parameter contract for snapshot-layer pre-decimation: the ring only
 * pre-decimates when it can prove the frame builder would elect the very same
 * samples, which requires the exact point budget and clip limit (after the
 * frame builder's own clamp) to be declared up front.
 */
export type EegSnapshotDecimation = {
  targetPointCount: number;
  clipUv: number;
};

/**
 * Fixed-capacity, channel-major typed-array ring of the most recent EEG
 * samples. Storage is truly circular: appending past capacity only advances
 * the head index and overwrites the retired slots in place, so steady-state
 * streaming never moves retained bytes (the previous shift-based design
 * memmoved the whole multi-megabyte window on every 50 ms block). The capacity
 * (maxWindowSeconds * sampleRateHz * 1.5) is enforced on every append, so a
 * hidden tab or unmounted route can no longer grow the buffer without bound.
 * An incremental per-channel EMA baseline is maintained at ingest time so
 * display code never re-sorts the window.
 */
export class EegRingBuffer {
  private readonly channels: EegChannel[];
  private readonly channelIndexById = new Map<string, number>();
  private readonly fallbackSampleRateHz: number;
  private readonly maxWindowSeconds: number;
  private sampleRateHz: number;
  private times = new Float64Array(0);
  private valuesByChannel: Float32Array[] = [];
  private baselines = new Float64Array(0);
  private markers: EegMarker[] = [];
  private head = 0;
  private length = 0;
  private lastSequence: number | null = null;
  // Survivor-index scratch for the pre-decimated snapshot path, grown to the
  // high-water mark and reused so steady-state snapshots allocate nothing for
  // selection. Owned by this instance because the ring consumes the selected
  // indexes itself instead of handing them to a frame builder.
  private selectedScratch = new Int32Array(0);

  constructor(channels: EegChannel[], fallbackSampleRateHz: number, maxWindowSeconds = 30) {
    if (channels.length === 0) {
      throw new Error('EEG channel list cannot be empty.');
    }
    if (fallbackSampleRateHz <= 0) {
      throw new Error('EEG sample rate must be positive.');
    }
    if (maxWindowSeconds <= 0) {
      throw new Error('EEG max window seconds must be positive.');
    }

    this.channels = channels;
    channels.forEach((channel, index) => this.channelIndexById.set(channel.id, index));
    this.fallbackSampleRateHz = fallbackSampleRateHz;
    this.maxWindowSeconds = maxWindowSeconds;
    this.sampleRateHz = fallbackSampleRateHz;
    this.allocate(this.capacityFor(fallbackSampleRateHz));
  }

  appendPayload(block: EegDecodedSampleBlock) {
    const sampleCount = block.samples[0]?.length ?? 0;
    this.lastSequence = block.sequence;
    if (sampleCount === 0 || block.samples.length === 0) {
      return;
    }

    this.ensureCapacity(block.sampleRateHz);
    const sampleRateHz = this.sampleRateHz;
    const channelCount = Math.min(block.samples.length, this.channels.length);
    const capacity = this.times.length;

    // A block larger than the whole capacity keeps only its newest samples.
    let firstSampleIndex = 0;
    if (sampleCount >= capacity) {
      firstSampleIndex = sampleCount - capacity;
      this.head = 0;
      this.length = 0;
      this.markers = [];
    } else {
      const overflow = this.length + sampleCount - capacity;
      if (overflow > 0) {
        // Retiring the oldest samples only moves the head; the write below
        // lands exactly at (head + length) and overwrites them in place.
        this.head = (this.head + overflow) % capacity;
        this.length = capacity - sampleCount;
        this.pruneMarkers();
      }
    }

    const startSeconds = block.startedAtMs / 1000;
    // Hot ingest path: one pass per destination row with the source/destination
    // arrays hoisted to locals keeps every sample write at two typed-array
    // loads, and the wrap is a compare-and-reset instead of a division.
    const startWriteIndex = (this.head + this.length) % capacity;
    let writeIndex = startWriteIndex;
    for (let sampleIndex = firstSampleIndex; sampleIndex < sampleCount; sampleIndex += 1) {
      this.times[writeIndex] = startSeconds + sampleIndex / sampleRateHz;
      if (++writeIndex === capacity) {
        writeIndex = 0;
      }
    }
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const src = block.samples[channelIndex];
      const dst = this.valuesByChannel[channelIndex];
      writeIndex = startWriteIndex;
      for (let sampleIndex = firstSampleIndex; sampleIndex < sampleCount; sampleIndex += 1) {
        dst[writeIndex] = src[sampleIndex] ?? 0;
        if (++writeIndex === capacity) {
          writeIndex = 0;
        }
      }
    }
    // Only the samples from firstSampleIndex onward land in the buffer, so
    // the retained count grows by that many — not by the full block size.
    this.length += sampleCount - firstSampleIndex;

    this.updateBaselines(block.samples, channelCount, sampleRateHz);

    if (MARKER_CLASSES.includes(block.triggerClass as EegTriggerCode)) {
      this.markers.push({
        timeSeconds: startSeconds,
        classId: block.triggerClass as EegTriggerCode,
      });
      this.pruneMarkers();
    }
  }

  toDisplayData(
    visibleChannelIds: Set<string>,
    timeWindowSeconds: number,
    decimation?: EegSnapshotDecimation,
  ): EegDisplaySnapshot {
    const safeWindowSeconds = Math.max(0.1, timeWindowSeconds);
    const latestTimeSeconds = this.length > 0 ? this.timeAt(this.length - 1) : 0;
    const windowStartSeconds = latestTimeSeconds - safeWindowSeconds;
    const startIndex = this.firstIndexAfter(windowStartSeconds);
    const count = this.length - startIndex;

    const visibleChannels = this.channels.filter((channel) => visibleChannelIds.has(channel.id));

    // Snapshot-layer pre-decimation (only when the frame parameters are
    // declared and the window actually dwarfs the point budget): run the
    // frame builder's own bucket-extrema scan straight over the ring interval
    // and copy out only the survivors, instead of linearly copying the whole
    // window (~7 MB/s of intermediate garbage at 10 s × 1000 Hz × 4 ch) just
    // for the downstream scan to keep ≤ a few thousand points.
    const targetPointCount = decimation?.targetPointCount ?? 0;
    if (
      decimation !== undefined
      && targetPointCount > 0
      && count > targetPointCount
      && visibleChannels.some((channel) => this.channelIndexById.has(channel.id))
    ) {
      return this.toDecimatedDisplayData(
        visibleChannels,
        count,
        startIndex,
        windowStartSeconds,
        latestTimeSeconds,
        { targetPointCount, clipLimit: Math.max(1, decimation.clipUv) },
      );
    }

    const seriesByChannel: Record<string, Float32Array> = {};
    const baselineByChannel: Record<string, number> = {};
    const capacity = this.times.length;
    const physicalStart = count > 0 ? (this.head + startIndex) % capacity : 0;

    if (count > 0) {
      visibleChannels.forEach((channel) => {
        const channelIndex = this.channelIndexById.get(channel.id);
        if (channelIndex === undefined) {
          return;
        }
        const series = new Float32Array(count);
        copyWrappedRange(series, this.valuesByChannel[channelIndex], physicalStart, count, capacity);
        seriesByChannel[channel.id] = series;
        baselineByChannel[channel.id] = Number.isFinite(this.baselines[channelIndex])
          ? this.baselines[channelIndex]
          : 0;
      });
    } else {
      visibleChannels.forEach((channel) => {
        seriesByChannel[channel.id] = new Float32Array(0);
        const channelIndex = this.channelIndexById.get(channel.id);
        baselineByChannel[channel.id] = channelIndex !== undefined
          && Number.isFinite(this.baselines[channelIndex])
          ? this.baselines[channelIndex]
          : 0;
      });
    }

    const x = new Float64Array(count);
    if (count > 0) {
      copyWrappedRange(x, this.times, physicalStart, count, capacity);
    }

    return {
      latestSequence: this.lastSequence,
      x,
      visibleChannels,
      seriesByChannel,
      baselineByChannel,
      markers: this.markers.filter((marker) => marker.timeSeconds > windowStartSeconds),
      retainedSampleCount: this.length,
    };
  }

  /**
   * Pre-decimated snapshot variant: selects survivor indexes with the SAME
   * shared bucket scan processEegDisplayFrame uses (single source of truth —
   * an independent ring-side formula could pick different extrema and the two
   * decimation layers would compound the distortion), then copies only those
   * samples out. Bit-equivalence to the full-copy pipeline:
   *
   * 1. Selection — the accessor hands the selector the identical Float32 bits
   *    (typed-array reads never round), the same per-channel baselines this
   *    snapshot publishes (missing/NaN read as zero), and the same post-clamp
   *    clip limit as the frame builder; with identical bucket geometry the
   *    comparison sequence is instruction-for-instruction the full path's, so
   *    argmin/argmax first-occurrence ties resolve to the same survivor set.
   * 2. Copy-out — survivors gather in ascending logical order, so x and every
   *    series hold bit-copies of exactly the elements the full-window arrays
   *    would carry at those positions.
   * 3. Frame build — the snapshot records its selection parameters in
   *    decimatedFor, so processEegDisplayFrame degrades to identity selection
   *    and reproduces the full-path frame bit-for-bit. latestTimeSeconds
   *    carries the true newest sample because bucket extrema need not include
   *    it (a flat tail elects earlier indexes) while cursor/cycle derive from
   *    that undecimated tail.
   */
  private toDecimatedDisplayData(
    visibleChannels: EegChannel[],
    count: number,
    startIndex: number,
    windowStartSeconds: number,
    latestTimeSeconds: number,
    decimation: { targetPointCount: number; clipLimit: number },
  ): EegDisplaySnapshot {
    const capacity = this.times.length;
    const physicalStart = (this.head + startIndex) % capacity;
    // Contiguous physical runs covering logical [0, count): [physicalStart,
    // physicalStart + wrapSplit) then, across the seam, [0, count - wrapSplit).
    const wrapSplit = Math.min(count, capacity - physicalStart);

    const slotIds: string[] = [];
    const slotStores: Float32Array[] = [];
    const slotBaselines: number[] = [];
    const seriesByChannel: Record<string, Float32Array> = {};
    const baselineByChannel: Record<string, number> = {};
    visibleChannels.forEach((channel) => {
      const channelIndex = this.channelIndexById.get(channel.id);
      if (channelIndex === undefined) {
        return;
      }
      slotIds.push(channel.id);
      slotStores.push(this.valuesByChannel[channelIndex]);
      const baseline = Number.isFinite(this.baselines[channelIndex])
        ? this.baselines[channelIndex]
        : 0;
      slotBaselines.push(baseline);
      baselineByChannel[channel.id] = baseline;
    });

    const scratchLength = displaySelectionBound(
      count,
      slotIds.length,
      decimation.targetPointCount,
    );
    if (this.selectedScratch.length < scratchLength) {
      this.selectedScratch = new Int32Array(scratchLength);
    }
    const selectedCount = selectDisplayIndexesFromInterval(
      {
        sampleCount: count,
        valueAt: (slot, index) => (
          slotStores[slot][index < wrapSplit ? physicalStart + index : index - wrapSplit]
        ),
        baselines: slotBaselines,
      },
      decimation.clipLimit,
      decimation.targetPointCount,
      this.selectedScratch,
    );

    const physicalOf = (logicalIndex: number) => (
      logicalIndex < wrapSplit ? physicalStart + logicalIndex : logicalIndex - wrapSplit
    );

    const x = new Float64Array(selectedCount);
    for (let k = 0; k < selectedCount; k += 1) {
      x[k] = this.times[physicalOf(this.selectedScratch[k])];
    }
    for (let slot = 0; slot < slotIds.length; slot += 1) {
      const store = slotStores[slot];
      const series = new Float32Array(selectedCount);
      for (let k = 0; k < selectedCount; k += 1) {
        series[k] = store[physicalOf(this.selectedScratch[k])];
      }
      seriesByChannel[slotIds[slot]] = series;
    }

    return {
      latestSequence: this.lastSequence,
      x,
      visibleChannels,
      seriesByChannel,
      baselineByChannel,
      markers: this.markers.filter((marker) => marker.timeSeconds > windowStartSeconds),
      retainedSampleCount: this.length,
      latestTimeSeconds,
      decimatedFor: {
        targetPointCount: decimation.targetPointCount,
        clipLimit: decimation.clipLimit,
      },
    };
  }

  /** Sequence number of the most recent appended block, for render skipping. */
  getLastSequence(): number | null {
    return this.lastSequence;
  }

  reset() {
    this.head = 0;
    this.length = 0;
    this.markers = [];
    this.lastSequence = null;
    this.baselines.fill(Number.NaN);
  }

  private ensureCapacity(sampleRateHz: number) {
    const effectiveRateHz = sampleRateHz > 0 ? sampleRateHz : this.fallbackSampleRateHz;
    if (effectiveRateHz !== this.sampleRateHz) {
      this.sampleRateHz = effectiveRateHz;
      this.reallocate(this.capacityFor(effectiveRateHz));
    }
  }

  private capacityFor(sampleRateHz: number) {
    return Math.max(1, Math.ceil(this.maxWindowSeconds * sampleRateHz * CAP_WINDOW_MULTIPLIER));
  }

  private timeAt(logicalIndex: number) {
    return this.times[(this.head + logicalIndex) % this.times.length];
  }

  private allocate(capacity: number) {
    this.times = new Float64Array(capacity);
    this.valuesByChannel = this.channels.map(() => new Float32Array(capacity));
    this.baselines = new Float64Array(this.channels.length).fill(Number.NaN);
    this.head = 0;
    this.length = 0;
  }

  private reallocate(capacity: number) {
    if (capacity === this.times.length) {
      return;
    }
    const previousCapacity = this.times.length;
    const keep = Math.min(this.length, capacity);
    const sourceStart = this.length - keep;
    const physicalStart = (this.head + sourceStart) % previousCapacity;

    const times = new Float64Array(capacity);
    const values = this.channels.map((_, channelIndex) => {
      const next = new Float32Array(capacity);
      if (keep > 0) {
        copyWrappedRange(next, this.valuesByChannel[channelIndex], physicalStart, keep, previousCapacity);
      }
      return next;
    });
    if (keep > 0) {
      copyWrappedRange(times, this.times, physicalStart, keep, previousCapacity);
    }
    this.times = times;
    this.valuesByChannel = values;
    this.head = 0;
    this.length = keep;
    this.pruneMarkers();
  }

  private updateBaselines(samples: Float32Array[], channelCount: number, sampleRateHz: number) {
    const alpha = Math.min(1, 1 / (sampleRateHz * EMA_TIME_CONSTANT_SECONDS));
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const series = samples[channelIndex];
      let baseline = this.baselines[channelIndex];
      if (!Number.isFinite(baseline)) {
        baseline = series[0];
      }
      for (let sampleIndex = 0; sampleIndex < series.length; sampleIndex += 1) {
        baseline += alpha * (series[sampleIndex] - baseline);
      }
      this.baselines[channelIndex] = baseline;
    }
  }

  private firstIndexAfter(timeSeconds: number) {
    let low = 0;
    let high = this.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.timeAt(mid) > timeSeconds) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    return low;
  }

  private pruneMarkers() {
    const oldestTimeSeconds = this.length > 0 ? this.timeAt(0) : Number.POSITIVE_INFINITY;
    while (this.markers.length > 0 && this.markers[0].timeSeconds < oldestTimeSeconds) {
      this.markers.shift();
    }
  }
}
