import {
  DEFAULT_EEG_CHANNELS,
  DEFAULT_VISIBLE_EEG_CHANNEL_IDS,
  MAX_VISIBLE_EEG_CHANNELS,
} from './channels';
import type { EegDisplaySettings, EegDisplaySnapshot } from './types';

export const DEFAULT_SAMPLE_RATE_HZ = 500;
export const DEFAULT_TIME_WINDOW_SECONDS = 10;
export const DEFAULT_AMPLITUDE_UV_PER_DIV = 100;

export function createInitialEegDisplaySettings(): EegDisplaySettings {
  return {
    timeWindowSeconds: DEFAULT_TIME_WINDOW_SECONDS,
    amplitudeUvPerDiv: DEFAULT_AMPLITUDE_UV_PER_DIV,
    visibleChannelIds: new Set(DEFAULT_VISIBLE_EEG_CHANNEL_IDS),
  };
}

export function createInitialEegSnapshot(): EegDisplaySnapshot {
  const visibleChannels = DEFAULT_EEG_CHANNELS.filter((channel) => (
    DEFAULT_VISIBLE_EEG_CHANNEL_IDS.includes(channel.id)
  ));

  return {
    latestSequence: null,
    x: [],
    visibleChannels,
    seriesByChannel: Object.fromEntries(visibleChannels.map((channel) => [channel.id, []])),
    markers: [],
    retainedSampleCount: 0,
  };
}

export function toggleEegChannelVisibility(
  currentVisibleChannelIds: Set<string>,
  channelId: string,
): Set<string> {
  const visibleChannelIds = new Set(currentVisibleChannelIds);

  if (visibleChannelIds.has(channelId)) {
    if (visibleChannelIds.size > 1) {
      visibleChannelIds.delete(channelId);
    }

    return visibleChannelIds;
  }

  if (visibleChannelIds.size >= MAX_VISIBLE_EEG_CHANNELS) {
    return visibleChannelIds;
  }

  visibleChannelIds.add(channelId);

  return visibleChannelIds;
}
