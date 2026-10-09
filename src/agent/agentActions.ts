import type { AgentPhase } from './agentFlow';

export type AgentActionRisk = 'safe' | 'stimulus' | 'resource_sensitive' | 'data_sensitive';

export type AgentActionId =
  | 'open_paradigm'
  | 'open_experiment_settings'
  | 'go_next_page'
  | 'go_to_phase'
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
  {
    id: 'open_paradigm',
    label: '打开实验范式',
    risk: 'safe',
    requiresConfirmation: false,
    allowedPhases: allPhases,
  },
  {
    id: 'open_experiment_settings',
    label: '打开实验设置',
    risk: 'safe',
    requiresConfirmation: false,
    allowedPhases: allPhases,
  },
  {
    id: 'go_next_page',
    label: '下一步',
    risk: 'safe',
    requiresConfirmation: false,
    allowedPhases: allPhases,
  },
  {
    id: 'go_to_phase',
    label: '进入阶段',
    risk: 'safe',
    requiresConfirmation: false,
    allowedPhases: allPhases,
  },
  {
    id: 'select_video',
    label: '选择视频',
    risk: 'safe',
    requiresConfirmation: false,
    allowedPhases: ['video_regulation'],
  },
  {
    id: 'play_video',
    label: '播放视频',
    risk: 'stimulus',
    requiresConfirmation: true,
    allowedPhases: ['video_regulation'],
    confirmationLabel: '播放调控视频？',
  },
  {
    id: 'generate_music',
    label: '生成音乐',
    risk: 'resource_sensitive',
    requiresConfirmation: true,
    allowedPhases: ['music_regulation'],
    confirmationLabel: '将生成调控音乐并写入音乐历史。是否确认？',
  },
  {
    id: 'skip_game',
    label: '跳过游戏',
    risk: 'safe',
    requiresConfirmation: false,
    allowedPhases: ['game_regulation'],
  },
  {
    id: 'finish_experiment',
    label: '完成实验',
    risk: 'safe',
    requiresConfirmation: false,
    allowedPhases: ['finish', 'recovery'],
  },
  {
    id: 'cancel',
    label: '取消',
    risk: 'safe',
    requiresConfirmation: false,
    allowedPhases: allPhases,
  },
] as const satisfies readonly AgentActionDefinition[];

export type AgentActionValidation = { ok: true } | { ok: false; reason: string };

export function getAgentAction(id: AgentActionId): AgentActionDefinition | undefined {
  return agentActions.find((action) => action.id === id);
}

export function requiresAgentConfirmation(id: AgentActionId): boolean {
  return getAgentAction(id)?.requiresConfirmation ?? false;
}

export function getAgentActionValidation(
  id: AgentActionId,
  phase: AgentPhase,
): AgentActionValidation {
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
