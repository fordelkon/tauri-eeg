import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EEG_CHANNELS,
  DEFAULT_VISIBLE_EEG_CHANNEL_IDS,
  MAX_VISIBLE_EEG_CHANNELS,
} from './channels';
import {
  DEFAULT_AMPLITUDE_UV_PER_DIV,
  DEFAULT_SAMPLE_RATE_HZ,
  DEFAULT_TIME_WINDOW_SECONDS,
  createInitialEegDisplaySettings,
  createInitialEegSnapshot,
  toggleEegChannelVisibility,
} from './eegSessionStore';

describe('eegSessionStore', () => {
  it('defines 32 EEG channels and defaults to the first 16 visible channels', () => {
    expect(DEFAULT_EEG_CHANNELS).toHaveLength(32);
    expect(DEFAULT_EEG_CHANNELS[0]).toEqual({ id: 'ch01', label: 'CH01', unit: 'uV' });
    expect(DEFAULT_EEG_CHANNELS[31]).toEqual({ id: 'ch32', label: 'CH32', unit: 'uV' });
    expect(MAX_VISIBLE_EEG_CHANNELS).toBe(16);
    expect(DEFAULT_VISIBLE_EEG_CHANNEL_IDS).toEqual(
      DEFAULT_EEG_CHANNELS.slice(0, MAX_VISIBLE_EEG_CHANNELS).map((channel) => channel.id),
    );
  });

  it('creates initial display settings with only the first 16 channels visible', () => {
    const settings = createInitialEegDisplaySettings();

    expect(settings.timeWindowSeconds).toBe(DEFAULT_TIME_WINDOW_SECONDS);
    expect(settings.amplitudeUvPerDiv).toBe(DEFAULT_AMPLITUDE_UV_PER_DIV);
    expect([...settings.visibleChannelIds]).toEqual(DEFAULT_VISIBLE_EEG_CHANNEL_IDS);
    expect(settings.visibleChannelIds.has('ch16')).toBe(true);
    expect(settings.visibleChannelIds.has('ch17')).toBe(false);
  });

  it('creates an empty snapshot that is ready for the waveform panel', () => {
    const snapshot = createInitialEegSnapshot();

    expect(DEFAULT_SAMPLE_RATE_HZ).toBe(500);
    expect(snapshot.latestSequence).toBeNull();
    expect(snapshot.x).toEqual([]);
    expect(snapshot.visibleChannels.map((channel) => channel.id)).toEqual(
      DEFAULT_VISIBLE_EEG_CHANNEL_IDS,
    );
    expect(snapshot.seriesByChannel.ch01).toEqual([]);
    expect(snapshot.seriesByChannel.ch16).toEqual([]);
    expect(snapshot.seriesByChannel.ch17).toBeUndefined();
    expect(snapshot.markers).toEqual([]);
    expect(snapshot.retainedSampleCount).toBe(0);
  });

  it('toggles channel visibility while enforcing one minimum and 16 maximum channels', () => {
    const fullSelection = new Set(DEFAULT_VISIBLE_EEG_CHANNEL_IDS);
    const stillFull = toggleEegChannelVisibility(fullSelection, 'ch17');

    expect([...stillFull]).toEqual(DEFAULT_VISIBLE_EEG_CHANNEL_IDS);
    expect(stillFull).not.toBe(fullSelection);

    const oneVisible = new Set(['ch01']);
    const stillOneVisible = toggleEegChannelVisibility(oneVisible, 'ch01');

    expect([...stillOneVisible]).toEqual(['ch01']);

    const withRoom = new Set(DEFAULT_VISIBLE_EEG_CHANNEL_IDS.slice(0, 15));
    const expanded = toggleEegChannelVisibility(withRoom, 'ch17');

    expect(expanded.has('ch17')).toBe(true);
    expect(expanded.size).toBe(MAX_VISIBLE_EEG_CHANNELS);
  });
});
