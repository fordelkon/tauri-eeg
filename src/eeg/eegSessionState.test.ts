import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  getEegStatus,
  listEegSessions,
  startEegRecording,
  stopEegRecording,
} from './eegApi';
import {
  canPauseRecord,
  canResumeRecord,
  canStartDevice,
  canStartRecord,
  canStopRecord,
  eegSessionReducer,
  initialEegSessionState,
} from './eegSessionState';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

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

  it('keeps streaming idle and exposes an error when recording fails to start', () => {
    const streaming = { ...initialEegSessionState, deviceStatus: 'streaming' as const };
    const failed = eegSessionReducer(streaming, {
      type: 'start_record_failed',
      message: 'Sign in before recording EEG.',
    });

    expect(failed).toMatchObject({
      deviceStatus: 'streaming',
      recordStatus: 'idle',
      errorMessage: 'Sign in before recording EEG.',
    });
    expect(canStartRecord(failed)).toBe(true);
  });
});

describe('eegApi recording commands', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('starts recording with the current user identity', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await startEegRecording({ userId: 'user-1', username: 'alice' });

    expect(invoke).toHaveBeenCalledWith('start_eeg_recording', {
      input: {
        userId: 'user-1',
        username: 'alice',
      },
    });
  });

  it('wraps recording status and session list commands', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ isRecording: false })
      .mockResolvedValueOnce([]);

    await stopEegRecording();
    await getEegStatus();
    await listEegSessions('user-1');

    expect(invoke).toHaveBeenNthCalledWith(1, 'stop_eeg_recording');
    expect(invoke).toHaveBeenNthCalledWith(2, 'get_eeg_status');
    expect(invoke).toHaveBeenNthCalledWith(3, 'list_eeg_sessions', { userId: 'user-1' });
  });
});
