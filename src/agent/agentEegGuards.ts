import type { EegDeviceStatus, EegRecordStatus } from '../eeg/eegSessionState';

/**
 * Runtime preconditions for the agent's EEG actions, read at execution time
 * from the same can* flags that gate the manual controls on the EEG page.
 * Phase validation alone let a mid-recording stop-device through and reported
 * success for actions the session state silently refused.
 */
export type AgentEegGuardView = {
  canPauseRecord: boolean;
  canResumeRecord: boolean;
  canStartDevice: boolean;
  canStartRecord: boolean;
  canStopDevice: boolean;
  canStopRecord: boolean;
  deviceStatus: EegDeviceStatus;
  recordStatus: EegRecordStatus;
};

export type AgentEegGuardVerdict = { ok: true } | { ok: false; reason: string };

export function toAgentEegGuardView(source: {
  canPauseRecord: boolean;
  canResumeRecord: boolean;
  canStartDevice: boolean;
  canStartRecord: boolean;
  canStopDevice: boolean;
  canStopRecord: boolean;
  deviceStatus: EegDeviceStatus;
  recordStatus: EegRecordStatus;
}): AgentEegGuardView {
  return source;
}

export function validateAgentStartDevice(view: AgentEegGuardView): AgentEegGuardVerdict {
  if (view.canStartDevice) {
    return { ok: true };
  }

  return {
    ok: false,
    // canStartDevice only refuses when streaming or mid-stop; name which.
    reason: view.deviceStatus === 'stopping'
      ? 'EEG 设备正在停止中，请等待停止完成后再试。'
      : 'EEG 设备正在采集中，无需重复启动。',
  };
}

export function validateAgentStopDevice(view: AgentEegGuardView): AgentEegGuardVerdict {
  if (view.canStopDevice) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: view.deviceStatus === 'stopping'
      ? 'EEG 设备正在停止中，请等待停止完成。'
      : 'EEG 设备尚未连接，无需停止。',
  };
}

export function validateAgentStartRecord(view: AgentEegGuardView): AgentEegGuardVerdict {
  if (view.canStartRecord) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: view.recordStatus === 'recording'
      ? '已有 EEG 记录进行中，请先停止当前记录。'
      : 'EEG 设备未就绪，请先启动设备并等待 EEG 与 Trigger 均已连接。',
  };
}

export function validateAgentPauseRecord(view: AgentEegGuardView): AgentEegGuardVerdict {
  if (view.canPauseRecord) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: view.recordStatus === 'paused'
      ? 'EEG 记录已处于暂停状态。'
      : '当前没有进行中的 EEG 记录可暂停。',
  };
}

export function validateAgentResumeRecord(view: AgentEegGuardView): AgentEegGuardVerdict {
  if (view.canResumeRecord) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: view.recordStatus === 'recording'
      ? 'EEG 记录正在进行中，无需继续。'
      : '当前没有已暂停的 EEG 记录可继续。',
  };
}

export function validateAgentStopAndSaveRecord(view: AgentEegGuardView): AgentEegGuardVerdict {
  if (view.canStopRecord) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: view.recordStatus === 'stopped'
      ? 'EEG 记录已停止并保存。'
      : '当前没有进行中的 EEG 记录可停止。',
  };
}
