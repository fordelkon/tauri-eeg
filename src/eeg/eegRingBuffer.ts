import type {
  EegChannel,
  EegDecodedSampleBlock,
  EegDisplaySnapshot,
  EegMarker,
  EegTriggerCode,
} from './types';

const CAP_WINDOW_MULTIPLIER = 1.5;
const EMA_TIME_CONSTANT_SECONDS = 1;

const MARKER_CLASSES: readonly EegTriggerCode[] = [1, 2, 255];

/**
 * Fixed-capacity, channel-major typed-array ring of the most recent EEG
 * samples. The capacity (maxWindowSeconds * sampleRateHz * 1.5) is enforced on
 * every append, so a hidden tab or unmounted route can no longer grow the
 * buffer without bound. An incremental per-channel EMA baseline is maintained
 * at ingest time so display code never re-sorts the window.
 */
export class EegRingBuffer {
  private readonly channels: EegChannel[];
  private readonly fallbackSampleRateHz: number;
  private readonly maxWindowSeconds: number;
  private sampleRateHz: number;
  private times = new Float64Array(0);
  private valuesByChannel: Float32Array[] = [];
  private baselines = new Float64Array(0);
  private markers: EegMarker[] = [];
  private length = 0;
  private lastSequence: number | null = null;

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

    // A block larger than the whole capacity keeps only its newest samples.
    let firstSampleIndex = 0;
    if (sampleCount >= this.times.length) {
      firstSampleIndex = sampleCount - this.times.length;
      this.length = 0;
      this.markers = [];
    } else {
      const overflow = this.length + sampleCount - this.times.length;
      if (overflow > 0) {
        this.dropOldest(overflow);
      }
    }

    const startSeconds = block.startedAtMs / 1000;
    for (let sampleIndex = firstSampleIndex; sampleIndex < sampleCount; sampleIndex += 1) {
      this.times[this.length] = startSeconds + sampleIndex / sampleRateHz;
      for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
        this.valuesByChannel[channelIndex][this.length] = (
          block.samples[channelIndex][sampleIndex] ?? 0
        );
      }
      this.length += 1;
    }

    this.updateBaselines(block.samples, channelCount, sampleRateHz);

    if (MARKER_CLASSES.includes(block.triggerClass as EegTriggerCode)) {
      this.markers.push({
        timeSeconds: startSeconds,
        classId: block.triggerClass as EegTriggerCode,
      });
      this.pruneMarkers();
    }
  }

  toDisplayData(visibleChannelIds: Set<string>, timeWindowSeconds: number): EegDisplaySnapshot {
    const safeWindowSeconds = Math.max(0.1, timeWindowSeconds);
    const latestTimeSeconds = this.length > 0 ? this.times[this.length - 1] : 0;
    const windowStartSeconds = latestTimeSeconds - safeWindowSeconds;
    const startIndex = this.firstIndexAfter(windowStartSeconds);

    const visibleChannels = this.channels.filter((channel) => visibleChannelIds.has(channel.id));
    const seriesByChannel: Record<string, number[]> = {};
    const baselineByChannel: Record<string, number> = {};

    visibleChannels.forEach((channel) => {
      const channelIndex = this.channels.indexOf(channel);
      seriesByChannel[channel.id] = Array.from(
        this.valuesByChannel[channelIndex].subarray(startIndex, this.length),
      );
      baselineByChannel[channel.id] = Number.isFinite(this.baselines[channelIndex])
        ? this.baselines[channelIndex]
        : 0;
    });

    return {
      latestSequence: this.lastSequence,
      x: Array.from(this.times.subarray(startIndex, this.length)),
      visibleChannels,
      seriesByChannel,
      baselineByChannel,
      markers: this.markers.filter((marker) => marker.timeSeconds > windowStartSeconds),
      retainedSampleCount: this.length,
    };
  }

  reset() {
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

  private allocate(capacity: number) {
    this.times = new Float64Array(capacity);
    this.valuesByChannel = this.channels.map(() => new Float32Array(capacity));
    this.baselines = new Float64Array(this.channels.length).fill(Number.NaN);
    this.length = 0;
  }

  private reallocate(capacity: number) {
    if (capacity === this.times.length) {
      return;
    }
    const keep = Math.min(this.length, capacity);
    const sourceStart = this.length - keep;
    const times = new Float64Array(capacity);
    const values = this.channels.map((_, channelIndex) => {
      const next = new Float32Array(capacity);
      if (keep > 0) {
        next.set(this.valuesByChannel[channelIndex].subarray(sourceStart, this.length));
      }
      return next;
    });
    if (keep > 0) {
      times.set(this.times.subarray(sourceStart, this.length));
    }
    this.times = times;
    this.valuesByChannel = values;
    this.length = keep;
    this.pruneMarkers();
  }

  private dropOldest(count: number) {
    const remaining = this.length - count;
    if (remaining <= 0) {
      this.length = 0;
      this.markers = [];
      return;
    }
    this.times.copyWithin(0, count, this.length);
    this.valuesByChannel.forEach((series) => series.copyWithin(0, count, this.length));
    this.length = remaining;
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
      if (this.times[mid] > timeSeconds) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    return low;
  }

  private pruneMarkers() {
    const oldestTimeSeconds = this.length > 0 ? this.times[0] : Number.POSITIVE_INFINITY;
    while (this.markers.length > 0 && this.markers[0].timeSeconds < oldestTimeSeconds) {
      this.markers.shift();
    }
  }
}
