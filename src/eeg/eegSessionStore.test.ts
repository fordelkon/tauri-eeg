import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AMPLITUDE_UV_PER_DIV,
  DEFAULT_SAMPLE_RATE_HZ,
  DEFAULT_TIME_WINDOW_SECONDS,
  createInitialEegDisplaySettings,
  createInitialEegSnapshot,
} from './eegSessionStore';

describe('eegSessionStore', () => {
  it('creates initial display settings with every channel visible', () => {
    const settings = createInitialEegDisplaySettings();

    expect(settings.timeWindowSeconds).toBe(DEFAULT_TIME_WINDOW_SECONDS);
    expect(settings.amplitudeUvPerDiv).toBe(DEFAULT_AMPLITUDE_UV_PER_DIV);
    expect(settings.visibleChannelIds.size).toBeGreaterThan(1);
    expect(settings.visibleChannelIds.has('fp1')).toBe(true);
  });

  it('creates an empty snapshot that is ready for the waveform panel', () => {
    const snapshot = createInitialEegSnapshot();

    expect(DEFAULT_SAMPLE_RATE_HZ).toBe(500);
    expect(snapshot.latestSequence).toBeNull();
    expect(snapshot.x).toEqual([]);
    expect(snapshot.visibleChannels.length).toBe(snapshot.visibleChannels.length);
    expect(snapshot.seriesByChannel.fp1).toEqual([]);
    expect(snapshot.markers).toEqual([]);
    expect(snapshot.retainedSampleCount).toBe(0);
  });
});
