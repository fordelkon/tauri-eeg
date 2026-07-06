import type { AgentPhase } from './agentFlow';

export type AgentActionRisk = 'safe' | 'stimulus' | 'resource_sensitive' | 'data_sensitive';

export type AgentActionId =
  | 'go_next_page'
  | 'go_to_phase'
  | 'start_eeg_device'
  | 'stop_eeg_device'
  | 'start_eeg_recording'
  | 'pause_eeg_recording'
  | 'resume_eeg_recording'
  | 'stop_and_save_eeg_recording'
  | 'start_eeg_device_and_record'
  | 'stop_save_eeg_and_go_next'
  | 'select_video'
  | 'play_video'
  | 'generate_music'
  | 'skip_game'
  | 'finish_experiment'
  | 'cancel';

export type AgentActionDefinition = {
  id: AgentActionId;
  label: string;
  risk: AgentActionRisk;
  requiresConfirmation: boolean;
  allowedPhases: readonly AgentPhase[];
  confirmationLabel?: string;
};

export type AgentPlannerVideoResource = {
  id: string;
  tags: string[];
  title: string;
};

export type AgentAvailableResources = {
  gameAvailable: boolean;
  musicGeneration: boolean;
  videos: AgentPlannerVideoResource[];
};

const eegPhases = ['baseline', 'recovery'] as const;
const allPhases = [
  'intro',
  'baseline',
  'video_regulation',
  'game_regulation',
  'music_regulation',
  'recovery',
  'finish',
] as const;

export const agentActions = [
  { id: 'go_next_page', label: '下一步', risk: 'safe', requiresConfirmation: false, allowedPhases: allPhases },
  { id: 'go_to_phase', label: '进入阶段', risk: 'safe', requiresConfirmation: false, allowedPhases: allPhases },
  { id: 'start_eeg_device', label: '启动 EEG 设备', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '启动 EEG 设备？' },
  { id: 'stop_eeg_device', label: '停止 EEG 设备', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '停止 EEG 设备？' },
  { id: 'start_eeg_recording', label: '开始 EEG 采集', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '开始当前阶段 EEG 采集？' },
  { id: 'pause_eeg_recording', label: '暂停 EEG 采集', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '暂停 EEG 采集？' },
  { id: 'resume_eeg_recording', label: '继续 EEG 采集', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '继续 EEG 采集？' },
  { id: 'stop_and_save_eeg_recording', label: '停止并保存 EEG 数据', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '停止并保存 EEG 数据？' },
  { id: 'start_eeg_device_and_record', label: '启动设备并开始 EEG 采集', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '将启动 EEG 设备并开始当前阶段 EEG 采集。是否确认？' },
  { id: 'stop_save_eeg_and_go_next', label: '停止保存并进入下一阶段', risk: 'data_sensitive', requiresConfirmation: true, allowedPhases: eegPhases, confirmationLabel: '将停止并保存当前 EEG 数据，并进入下一阶段。是否确认？' },
  { id: 'select_video', label: '选择视频', risk: 'safe', requiresConfirmation: false, allowedPhases: ['video_regulation'] },
  { id: 'play_video', label: '播放视频', risk: 'stimulus', requiresConfirmation: true, allowedPhases: ['video_regulation'], confirmationLabel: '播放调控视频？' },
  { id: 'generate_music', label: '生成音乐', risk: 'resource_sensitive', requiresConfirmation: true, allowedPhases: ['music_regulation'], confirmationLabel: '将生成调控音乐并写入音乐历史。是否确认？' },
  { id: 'skip_game', label: '跳过游戏', risk: 'safe', requiresConfirmation: false, allowedPhases: ['game_regulation'] },
  { id: 'finish_experiment', label: '完成实验', risk: 'safe', requiresConfirmation: false, allowedPhases: ['finish', 'recovery'] },
  { id: 'cancel', label: '取消', risk: 'safe', requiresConfirmation: false, allowedPhases: allPhases },
] as const satisfies readonly AgentActionDefinition[];

export type AgentActionValidation = { ok: true } | { ok: false; reason: string };

export function getAgentAction(id: AgentActionId): AgentActionDefinition | undefined {
  return agentActions.find((action) => action.id === id);
}

export function requiresAgentConfirmation(id: AgentActionId): boolean {
  return getAgentAction(id)?.requiresConfirmation ?? false;
}

export function getAgentActionValidation(id: AgentActionId, phase: AgentPhase): AgentActionValidation {
  const action = getAgentAction(id);

  if (!action) {
    return { ok: false, reason: '无法识别该操作。' };
  }

  if (!action.allowedPhases.includes(phase)) {
    return { ok: false, reason: '当前阶段不能执行该操作。' };
  }

  return { ok: true };
}

export function getAgentAvailableResourcesForPhase(
  phase: AgentPhase,
  videos: AgentPlannerVideoResource[],
): AgentAvailableResources {
  return {
    gameAvailable: false,
    musicGeneration: phase === 'music_regulation',
    videos: phase === 'video_regulation' ? videos : [],
  };
}
