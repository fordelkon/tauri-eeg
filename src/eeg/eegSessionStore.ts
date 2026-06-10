import { DEFAULT_EEG_CHANNELS } from './channels';
import type { EegDisplaySettings, EegDisplaySnapshot } from './types';

export const DEFAULT_SAMPLE_RATE_HZ = 500;
export const DEFAULT_TIME_WINDOW_SECONDS = 10;
export const DEFAULT_AMPLITUDE_UV_PER_DIV = 100;

export function createInitialEegDisplaySettings(): EegDisplaySettings {
  return {
    timeWindowSeconds: DEFAULT_TIME_WINDOW_SECONDS,
    amplitudeUvPerDiv: DEFAULT_AMPLITUDE_UV_PER_DIV,
    visibleChannelIds: new Set(DEFAULT_EEG_CHANNELS.map((channel) => channel.id)),
  };
}

export function createInitialEegSnapshot(): EegDisplaySnapshot {
  return {
    latestSequence: null,
    x: [],
    visibleChannels: DEFAULT_EEG_CHANNELS,
    seriesByChannel: Object.fromEntries(DEFAULT_EEG_CHANNELS.map((channel) => [channel.id, []])),
    markers: [],
    retainedSampleCount: 0,
  };
}
