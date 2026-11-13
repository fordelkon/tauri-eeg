import { invoke } from '@tauri-apps/api/core';
import type { ParadigmSessionKind } from '../paradigm/types';
import type { ExperimentPreferences } from './settings';

export type RecordingPlan = {
  userId: string;
  subjectId: string;
  kind: 'effect_evaluation' | ParadigmSessionKind;
  condition?: 'natural_recovery' | 'regulation';
  method?: 'music' | 'video';
  session?: number;
};

export type RecordingDestination = { path: string; fileName: string; runIndex: number };

export function recordingPlanKey(plan: RecordingPlan): string {
  const effect = plan.kind === 'effect_evaluation';
  return JSON.stringify([
    plan.userId,
    plan.subjectId.trim(),
    plan.session ?? 1,
    plan.kind,
    effect ? plan.condition : null,
    effect && plan.condition === 'regulation' ? plan.method : null,
  ]);
}

export function reserveRecordingPath(input: RecordingPlan): Promise<RecordingDestination> {
  return invoke('reserve_bdf_destination', { input });
}

export function requirePreparedRecording(preferences: ExperimentPreferences, plan: RecordingPlan) {
  if (
    !preferences.externalRecordingConfirmed ||
    !preferences.expectedRecordingName.trim() ||
    preferences.recordingPlanKey !== recordingPlanKey(plan)
  ) {
    throw new Error(
      '当前账号、被试或实验方案尚未确认录制路径。请返回实验设置，准备本次 BDF 并确认 ActiView 正在保存。',
    );
  }
}

export function triggerCheckPath(path: string): string {
  return path.replace(/_run-(\d+)_eeg\.bdf$/i, '_acq-triggercheck_run-$1_eeg.bdf');
}
