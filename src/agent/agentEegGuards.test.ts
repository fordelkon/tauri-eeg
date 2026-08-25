import { describe, expect, it } from 'vitest';
import {
  type AgentEegGuardView,
  validateAgentPauseRecord,
  validateAgentResumeRecord,
  validateAgentStartDevice,
  validateAgentStartRecord,
  validateAgentStopAndSaveRecord,
  validateAgentStopDevice,
} from './agentEegGuards';

function makeView(overrides: Partial<AgentEegGuardView> = {}): AgentEegGuardView {
  return {
    // Idle device: everything refused, matching the manual controls.
    canPauseRecord: false,
    canResumeRecord: false,
    canStartDevice: true,
    canStartRecord: false,
    canStopDevice: false,
    canStopRecord: false,
    deviceStatus: 'disconnected',
    recordStatus: 'idle',
    ...overrides,
  };
}

const streamingIdle = {
  deviceStatus: 'streaming',
  recordStatus: 'idle',
  canStartDevice: false,
  canStartRecord: true,
  canStopDevice: true,
} as const;

describe('agent EEG runtime guards', () => {
  it('allows start-device only from the states the manual gate allows', () => {
    expect(validateAgentStartDevice(makeView())).toEqual({ ok: true });
    expect(validateAgentStartDevice(makeView({ deviceStatus: 'error' }))).toEqual({ ok: true });

    const streaming = validateAgentStartDevice(makeView({
      ...streamingIdle,
      deviceStatus: 'streaming',
    }));
    expect(streaming).toEqual({ ok: false, reason: expect.stringContaining('无需重复启动') });

    const stopping = validateAgentStartDevice(makeView({
      deviceStatus: 'stopping',
      canStartDevice: false,
    }));
    expect(stopping).toEqual({ ok: false, reason: expect.stringContaining('正在停止中') });
  });

  it('refuses stop-device while streaming a recording unless the save-first path handles it', () => {
    expect(validateAgentStopDevice(makeView(streamingIdle))).toEqual({ ok: true });

    expect(validateAgentStopDevice(makeView())).toEqual({
      ok: false,
      reason: expect.stringContaining('尚未连接'),
    });
    expect(validateAgentStopDevice(makeView({ deviceStatus: 'stopping' }))).toEqual({
      ok: false,
      reason: expect.stringContaining('正在停止中'),
    });
  });

  it('names the running recording as the start-record blocker instead of claiming success', () => {
    expect(validateAgentStartRecord(makeView(streamingIdle))).toEqual({ ok: true });

    expect(validateAgentStartRecord(makeView({
      ...streamingIdle,
      recordStatus: 'recording',
      canStartRecord: false,
    })).ok).toBe(false);

    expect(validateAgentStartRecord(makeView()).ok).toBe(false);
  });

  it('gates pause/resume on an active respectively paused recording', () => {
    expect(validateAgentPauseRecord(makeView({
      ...streamingIdle,
      recordStatus: 'recording',
      canPauseRecord: true,
    }))).toEqual({ ok: true });

    const pausedRefusal = validateAgentPauseRecord(makeView(streamingIdle));
    expect(pausedRefusal.ok).toBe(false);

    expect(validateAgentResumeRecord(makeView({
      ...streamingIdle,
      recordStatus: 'paused',
      canResumeRecord: true,
    }))).toEqual({ ok: true });

    const recordingRefusal = validateAgentResumeRecord(makeView({
      ...streamingIdle,
      recordStatus: 'recording',
      canResumeRecord: false,
    }));
    expect(recordingRefusal).toEqual({ ok: false, reason: expect.stringContaining('正在进行中') });
  });

  it('gates stop-and-save on a recording that can actually be saved', () => {
    expect(validateAgentStopAndSaveRecord(makeView({
      ...streamingIdle,
      recordStatus: 'recording',
      canStopRecord: true,
    }))).toEqual({ ok: true });

    expect(validateAgentStopAndSaveRecord(makeView({
      ...streamingIdle,
      recordStatus: 'paused',
      canStopRecord: true,
    }))).toEqual({ ok: true });

    const alreadyStopped = validateAgentStopAndSaveRecord(makeView({
      ...streamingIdle,
      recordStatus: 'stopped',
      canStopRecord: false,
    }));
    expect(alreadyStopped).toEqual({ ok: false, reason: expect.stringContaining('已停止并保存') });

    expect(validateAgentStopAndSaveRecord(makeView(streamingIdle)).ok).toBe(false);
  });
});
