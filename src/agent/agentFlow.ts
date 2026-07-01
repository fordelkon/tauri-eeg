export type AgentPhase =
  | 'intro'
  | 'baseline'
  | 'video_regulation'
  | 'game_regulation'
  | 'music_regulation'
  | 'recovery'
  | 'finish';

export type AgentRoute =
  | '/home'
  | '/eeg-acquisition'
  | '/video-regulation'
  | '/game-regulation'
  | '/music-regulation';

export const agentPhases = [
  'intro',
  'baseline',
  'video_regulation',
  'game_regulation',
  'music_regulation',
  'recovery',
  'finish',
] as const satisfies readonly AgentPhase[];

export const agentPromptExamples = [
  '开始实验',
  '下一步',
  '开始基线采集',
  '播放放松视频',
  '生成舒缓音乐',
  '结束并保存数据',
  '跳过当前不可用环节',
] as const;

const phaseRoutes = {
  intro: '/home',
  baseline: '/eeg-acquisition',
  video_regulation: '/video-regulation',
  game_regulation: '/game-regulation',
  music_regulation: '/music-regulation',
  recovery: '/eeg-acquisition',
  finish: '/home',
} as const satisfies Record<AgentPhase, AgentRoute>;

const nextPhases = {
  intro: 'baseline',
  baseline: 'video_regulation',
  video_regulation: 'game_regulation',
  game_regulation: 'music_regulation',
  music_regulation: 'recovery',
  recovery: 'finish',
  finish: 'finish',
} as const satisfies Record<AgentPhase, AgentPhase>;

const recommendedPrompts = {
  intro: '开始实验',
  baseline: '开始基线采集',
  video_regulation: '播放放松视频',
  game_regulation: '跳过当前不可用环节',
  music_regulation: '生成舒缓音乐',
  recovery: '结束并保存数据',
  finish: '实验已完成',
} as const satisfies Record<AgentPhase, string>;

const phasePromptExamples = {
  intro: [agentPromptExamples[0], agentPromptExamples[1]],
  baseline: [agentPromptExamples[1], agentPromptExamples[2]],
  video_regulation: [agentPromptExamples[1], agentPromptExamples[3]],
  game_regulation: [agentPromptExamples[1], agentPromptExamples[6]],
  music_regulation: [agentPromptExamples[1], agentPromptExamples[4]],
  recovery: [agentPromptExamples[1], agentPromptExamples[5]],
  finish: [agentPromptExamples[1], agentPromptExamples[5]],
} as const satisfies Record<AgentPhase, readonly string[]>;

export function isAgentPhase(value: string): value is AgentPhase {
  return agentPhases.includes(value as AgentPhase);
}

export function getRouteForAgentPhase(phase: AgentPhase): AgentRoute {
  return phaseRoutes[phase];
}

export function getNextAgentPhase(phase: AgentPhase): AgentPhase {
  return nextPhases[phase];
}

export function getRecommendedPrompt(phase: AgentPhase): string {
  return recommendedPrompts[phase];
}

export function getAgentPromptExamplesForPhase(phase: AgentPhase): readonly string[] {
  return phasePromptExamples[phase];
}

export function getAgentPhaseForRoute(pathname: string, previousPhase: AgentPhase = 'intro'): AgentPhase {
  if (pathname === '/home') {
    return previousPhase === 'finish' || previousPhase === 'recovery' ? 'finish' : 'intro';
  }

  if (pathname === '/eeg-acquisition') {
    return previousPhase === 'music_regulation' || previousPhase === 'recovery' ? 'recovery' : 'baseline';
  }

  if (pathname === '/video-regulation') {
    return 'video_regulation';
  }

  if (pathname === '/game-regulation') {
    return 'game_regulation';
  }

  if (pathname === '/music-regulation') {
    return 'music_regulation';
  }

  return previousPhase;
}
