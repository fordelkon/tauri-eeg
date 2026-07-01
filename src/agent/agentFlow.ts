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

const localRegulationPromptPools: Partial<Record<AgentPhase, readonly string[]>> = {
  video_regulation: [
    '播放森林放松视频',
    '播放海岸舒缓视频',
    '播放山谷静心视频',
    '播放天空呼吸视频',
    '播放湖面安定视频',
    '播放日落放松视频',
    '播放焦虑缓解视频',
    '播放疲惫恢复视频',
    '播放低落提振视频',
    '播放压力舒展视频',
    '播放烦躁降噪视频',
    '播放睡前安定视频',
    '播放紧张放松视频',
    '播放情绪稳定视频',
    '播放专注恢复视频',
    '播放呼吸引导视频',
  ],
  music_regulation: [
    '生成钢琴雨声音乐',
    '生成低频呼吸音乐',
    '生成森林环境音乐',
    '生成海浪舒缓音乐',
    '生成冥想放松音乐',
    '生成轻柔白噪音乐',
    '生成焦虑缓解音乐',
    '生成疲惫恢复音乐',
    '生成低落提振音乐',
    '生成压力释放音乐',
    '生成烦躁安抚音乐',
    '生成睡眠准备音乐',
    '生成紧张放松音乐',
    '生成情绪稳定音乐',
    '生成专注恢复音乐',
    '生成呼吸同步音乐',
  ],
};

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

export function getLocalRegulationPromptExamples(
  phase: AgentPhase,
  random: () => number = Math.random,
): string[] {
  const pool = localRegulationPromptPools[phase] ?? [];
  const candidates = [...pool];
  const selected: string[] = [];

  while (selected.length < 2 && candidates.length > 0) {
    const index = Math.floor(random() * candidates.length);
    selected.push(candidates.splice(index, 1)[0]);
  }

  return selected;
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
