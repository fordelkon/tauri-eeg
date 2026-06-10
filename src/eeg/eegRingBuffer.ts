import type { EegChannel, EegDisplaySnapshot, EegMarker, EegSampleBlockPayload } from './types';

type RetainedSample = {
  sequence: number;
  timeSeconds: number;
  valuesByChannel: Record<string, number>;
};

export class EegRingBuffer {
  private readonly channels: EegChannel[];
  private readonly fallbackSampleRateHz: number;
  private samples: RetainedSample[] = [];
  private markers: EegMarker[] = [];

  constructor(channels: EegChannel[], fallbackSampleRateHz: number) {
    if (channels.length === 0) {
      throw new Error('EEG channel list cannot be empty.');
    }
    if (fallbackSampleRateHz <= 0) {
      throw new Error('EEG sample rate must be positive.');
    }

    this.channels = channels;
    this.fallbackSampleRateHz = fallbackSampleRateHz;
  }

  appendPayload(payload: EegSampleBlockPayload) {
    const sampleRateHz = payload.sampleRateHz > 0
      ? payload.sampleRateHz
      : this.fallbackSampleRateHz;
    const sampleCount = payload.samples[0]?.length ?? 0;

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const valuesByChannel: Record<string, number> = {};

      payload.channelIds.forEach((channelId, channelIndex) => {
        valuesByChannel[channelId] = payload.samples[channelIndex]?.[sampleIndex] ?? 0;
      });

      this.samples.push({
        sequence: payload.sequence,
        timeSeconds: payload.startedAtMs / 1000 + sampleIndex / sampleRateHz,
        valuesByChannel,
      });
    }

    if (payload.triggerClass === 1 || payload.triggerClass === 2 || payload.triggerClass === 255) {
      this.markers.push({
        timeSeconds: payload.startedAtMs / 1000,
        classId: payload.triggerClass,
      });
    }
  }

  toDisplayData(visibleChannelIds: Set<string>, timeWindowSeconds: number): EegDisplaySnapshot {
    const safeWindowSeconds = Math.max(0.1, timeWindowSeconds);
    const latestSample = this.samples[this.samples.length - 1];
    const latestTimeSeconds = latestSample?.timeSeconds ?? 0;
    const windowStartSeconds = latestTimeSeconds - safeWindowSeconds;

    this.samples = this.samples.filter((sample) => sample.timeSeconds > windowStartSeconds);
    this.markers = this.markers.filter((marker) => marker.timeSeconds > windowStartSeconds);

    const visibleChannels = this.channels.filter((channel) => visibleChannelIds.has(channel.id));
    const seriesByChannel: Record<string, number[]> = {};

    visibleChannels.forEach((channel) => {
      seriesByChannel[channel.id] = this.samples.map(
        (sample) => sample.valuesByChannel[channel.id] ?? 0,
      );
    });

    return {
      latestSequence: this.samples[this.samples.length - 1]?.sequence ?? null,
      x: this.samples.map((sample) => sample.timeSeconds),
      visibleChannels,
      seriesByChannel,
      markers: [...this.markers],
      retainedSampleCount: this.samples.length,
    };
  }

  reset() {
    this.samples = [];
    this.markers = [];
  }
}
