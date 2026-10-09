import { invoke } from '@tauri-apps/api/core';

export type ExperimentMode = 'formal' | 'rehearsal';
export type TriggerStatus = {
  connected: boolean;
  portName: string | null;
  activeRunId: string | null;
  lastError: string | null;
};
export type ExperimentRun = {
  runId: string;
  userId: string | null;
  subjectId: string;
  kind: string;
  mode: ExperimentMode;
  status: string;
  emotion: string | null;
  condition: string | null;
  method: string | null;
  durationMinutes: number | null;
  startedAt: string;
  endedAt: string | null;
  protocolVersion: string;
  eventMappingVersion: string;
  externalRecordingConfirmedAt: string | null;
  expectedRecordingName: string | null;
  bdfFiles: string[];
};
export type CreateRunInput = {
  userId: string | null;
  subjectId: string;
  flowKind: string;
  emotion?: string;
  condition?: string;
  method?: string;
  durationMinutes?: number;
  mode: ExperimentMode;
  externalRecordingConfirmed: boolean;
  expectedRecordingName?: string;
  materials?: unknown;
};
export type ExperimentEvent = {
  eventId: string;
  runId: string;
  event: string;
  sequence: number;
  code: number;
  result: 'written' | 'rehearsal' | 'failed' | 'unknown';
  error: string | null;
};
export type EmitEventInput = {
  runId: string;
  eventId: string;
  phaseInstanceId: string;
  eventName: string;
  trialId?: string;
  mediaId?: string;
  source: string;
  frontendMonotonicMs: number;
  details?: unknown;
};

export const listTriggerPorts = () =>
  invoke<{ portName: string; description: string }[]>('trigger_list_ports');
export const getTriggerStatus = () => invoke<TriggerStatus>('trigger_status');
export const connectTrigger = (portName: string) =>
  invoke<TriggerStatus>('trigger_connect', { portName });
export const disconnectTrigger = () => invoke<TriggerStatus>('trigger_disconnect');
export const testTrigger = () => invoke<TriggerStatus>('trigger_test');

export function createRun({ flowKind, ...input }: CreateRunInput) {
  if (!input.userId) return Promise.reject(new Error('请先登录再开始实验。'));
  return invoke<ExperimentRun>('experiment_start', { input: { ...input, kind: flowKind } });
}

export async function emitEvent({ eventName, frontendMonotonicMs, ...input }: EmitEventInput) {
  const event = await invoke<ExperimentEvent>('experiment_event', {
    input: { ...input, event: eventName, softwareTimeMs: frontendMonotonicMs },
  });
  if (event.result === 'failed' || event.result === 'unknown') {
    throw new Error(event.error ?? 'Trigger 发送未完成，当前实验已中断。');
  }
  return event;
}

export function finishRun(
  runId: string,
  status: 'completed' | 'aborted',
  reason = '操作者结束实验',
) {
  return status === 'completed'
    ? invoke<ExperimentRun>('experiment_finish', { runId })
    : invoke<ExperimentRun>('experiment_abort', { runId, reason });
}

export const listRuns = (userId?: string) => invoke<ExperimentRun[]>('experiment_list', { userId });
export const associateBdf = (runId: string, bdfFiles: string[]) =>
  invoke<ExperimentRun>('experiment_associate_bdf', { runId, bdfFiles });
export const exportRun = (runId: string, path: string) =>
  invoke<{ path: string }>('experiment_export', { runId, path });
export const linkScale = (runId: string, recordId: string, phase: 'baseline' | 'post') =>
  invoke<void>('experiment_link_scale', { runId, recordId, measurementTime: phase });
export const saveTrial = <T extends { trialId: string }>(runId: string, trial: T) =>
  invoke<T>('experiment_save_trial', { runId, trial });
