import { describe, expect, it } from 'vitest';
import {
  canPauseRecord,
  canResumeRecord,
  canStartDevice,
  canStartRecord,
  canStopRecord,
  eegSessionReducer,
  initialEegSessionState,
} from './eegSessionState';

describe('eegSessionReducer', () => {
  it('starts the device once and enters previewing without recording', () => {
    const starting = eegSessionReducer(initialEegSessionState, { type: 'start_device_requested' });
    const previewing = eegSessionReducer(starting, { type: 'start_device_succeeded' });

    expect(starting).toMatchObject({ deviceStatus: 'starting', recordStatus: 'idle' });
    expect(previewing).toMatchObject({ deviceStatus: 'streaming', recordStatus: 'idle' });
    expect(canStartDevice(previewing)).toBe(false);
    expect(canStartRecord(previewing)).toBe(true);
  });

  it('treats stop as stopping the current recording segment, not the device stream', () => {
    const streaming = { ...initialEegSessionState, deviceStatus: 'streaming' as const };
    const recording = eegSessionReducer(streaming, { type: 'start_record' });
    const stopped = eegSessionReducer(recording, { type: 'stop_record' });

    expect(recording).toMatchObject({ deviceStatus: 'streaming', recordStatus: 'recording' });
    expect(stopped).toMatchObject({ deviceStatus: 'streaming', recordStatus: 'stopped' });
    expect(canStartDevice(stopped)).toBe(false);
    expect(canStartRecord(stopped)).toBe(true);
  });

  it('pauses and resumes recording while the device keeps streaming', () => {
    const recording = {
      ...initialEegSessionState,
      deviceStatus: 'streaming' as const,
      recordStatus: 'recording' as const,
    };
    const paused = eegSessionReducer(recording, { type: 'pause_record' });
    const resumed = eegSessionReducer(paused, { type: 'resume_record' });

    expect(paused).toMatchObject({ deviceStatus: 'streaming', recordStatus: 'paused' });
    expect(canPauseRecord(paused)).toBe(false);
    expect(canResumeRecord(paused)).toBe(true);
    expect(resumed).toMatchObject({ deviceStatus: 'streaming', recordStatus: 'recording' });
  });

  it('exposes button guards for each state', () => {
    const disconnected = initialEegSessionState;
    const streamingIdle = { ...initialEegSessionState, deviceStatus: 'streaming' as const };
    const recording = { ...streamingIdle, recordStatus: 'recording' as const };

    expect(canStartDevice(disconnected)).toBe(true);
    expect(canStartRecord(disconnected)).toBe(false);
    expect(canStartRecord(streamingIdle)).toBe(true);
    expect(canPauseRecord(recording)).toBe(true);
    expect(canStopRecord(recording)).toBe(true);
  });
});
