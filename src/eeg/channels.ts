import type { EegChannel } from './types';

export const MAX_VISIBLE_EEG_CHANNELS = 16;
export const DEFAULT_VISIBLE_EEG_CHANNEL_COUNT = 4;

export const DEFAULT_EEG_CHANNELS: EegChannel[] = Array.from({ length: 32 }, (_, index) => {
  const channelNumber = String(index + 1).padStart(2, '0');

  return {
    id: `ch${channelNumber}`,
    label: `CH${channelNumber}`,
    unit: 'uV',
  };
});

export const DEFAULT_VISIBLE_EEG_CHANNEL_IDS = DEFAULT_EEG_CHANNELS
  .slice(0, DEFAULT_VISIBLE_EEG_CHANNEL_COUNT)
  .map((channel) => channel.id);
