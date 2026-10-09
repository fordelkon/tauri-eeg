import type { ExperimentMode } from './api';

export type PreparationStep = 'plan' | 'connection' | 'materials' | 'recording' | 'review';
export type ExperimentDestination = 'effect' | 'paradigm';

export type PreparationInput = {
  mode: ExperimentMode;
  desktop: boolean;
  connected: boolean;
  libraryValidated: boolean;
  externalRecordingConfirmed: boolean;
  activeRunId: string | null;
};

export function getPreparationReadiness(input: PreparationInput): {
  canEnter: boolean;
  blockers: string[];
} {
  const blockers: string[] = [];
  if (!input.desktop) blockers.push('请在桌面应用中准备并开始实验。');
  if (input.activeRunId !== null) blockers.push('当前实验尚未结束，请先完成或中止当前实验。');
  if (!input.libraryValidated) blockers.push('请先选择素材库并完成验证。');
  if (input.mode === 'formal') {
    if (!input.connected) blockers.push('请先连接触发盒。');
    if (!input.externalRecordingConfirmed)
      blockers.push('请先在 ActiView 开始保存 BDF，并确认保存秒数正在增加。');
  }
  return { canEnter: blockers.length === 0, blockers };
}
