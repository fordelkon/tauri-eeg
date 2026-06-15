import { describe, expect, it } from 'vitest';
import { buildEegStatusPanelView } from './eegStatusPanelView';

describe('buildEegStatusPanelView', () => {
  it('summarizes idle disconnected EEG state for the global status panel', () => {
    const view = buildEegStatusPanelView({
      channelCount: 32,
      deviceStatus: 'disconnected',
      errorMessage: null,
      recordStatus: 'idle',
      retainedSampleCount: 0,
      sampleRateHz: 500,
      visibleChannelCount: 32,
    });

    expect(view.headline).toBe('EEG Offline');
    expect(view.deviceLabel).toBe('Disconnected');
    expect(view.recordLabel).toBe('Idle');
    expect(view.sampleRateLabel).toBe('500 Hz');
    expect(view.channelsLabel).toBe('32/32');
    expect(view.bufferLabel).toBe('0 samples');
    expect(view.tone).toBe('offline');
  });

  it('prioritizes errors over the current device status', () => {
    const view = buildEegStatusPanelView({
      channelCount: 32,
      deviceStatus: 'streaming',
      errorMessage: 'TCP server unavailable',
      recordStatus: 'recording',
      retainedSampleCount: 1024,
      sampleRateHz: 1000,
      visibleChannelCount: 8,
    });

    expect(view.headline).toBe('EEG Attention Required');
    expect(view.errorMessage).toBe('TCP server unavailable');
    expect(view.recordLabel).toBe('Recording');
    expect(view.tone).toBe('error');
  });
});
