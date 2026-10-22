import type { RegulationVideo } from '../video/paradigmRegulationCatalog';
import { getCurrentRegulationVideos } from '../video/regulationVideoResources';

export type AgentPhase =
  | 'intro'
  | 'baseline'
  | 'video_regulation'
  | 'game_regulation'
  | 'music_regulation'
  | 'recovery'
  | 'finish';

export type AgentRoute =
  '/home' | '/experiment-settings' | '/video-regulation' | '/game-regulation' | '/music-regulation';

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
  '打开实验范式',
  '播放放松视频',
  '生成舒缓音乐',
  '打开实验设置',
  '跳过当前不可用环节',
] as const;

const phaseRoutes = {
  intro: '/home',
  baseline: '/experiment-settings',
  video_regulation: '/video-regulation',
  game_regulation: '/game-regulation',
  music_regulation: '/music-regulation',
  recovery: '/experiment-settings',
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
  baseline: '打开实验范式',
  video_regulation: '播放放松视频',
  game_regulation: '跳过当前不可用环节',
  music_regulation: '生成舒缓音乐',
  recovery: '打开实验设置',
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
  if (phase === 'video_regulation') {
    const currentVideos = getCurrentRegulationVideos();
    if (currentVideos.length > 0) {
      const first = currentVideos[0];
      if (first.emotion === 'anxiety') return '播放焦虑诱发视频';
      if (first.emotion === 'depression') return '播放抑郁诱发视频';
      if (first.emotion === 'fear') return '播放恐惧诱发视频';
      if (first.emotion === 'calm') return '播放平静放松视频';
    }
  }
  return recommendedPrompts[phase];
}

export function getAgentPromptExamplesForPhase(phase: AgentPhase): readonly string[] {
  return phasePromptExamples[phase];
}

export function extractVideoTagPromptCandidates(
  videos: readonly RegulationVideo[],
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const add = (prompt: string) => {
    if (!seen.has(prompt)) {
      seen.add(prompt);
      candidates.push(prompt);
    }
  };

  // 1. Scene labels (e.g. 封闭暗室, 太空舱室, 童话治愈, 海岸浪花, 水流雨声)
  for (const video of videos) {
    if (video.sceneLabel) {
      const cleanLabel = video.sceneLabel.replace(/绝境|永别|悬念/g, '');
      add(`播放${cleanLabel}视频`);
    }
  }

  // 2. Specific tags (e.g. 海景, 星空, 灾难, 逃生, 密闭, 悬疑)
  for (const video of videos) {
    if (video.tags) {
      for (const tag of video.tags) {
        if (tag.length >= 2 && !['焦虑', '抑郁', '恐惧', '平静'].includes(tag)) {
          add(`播放${tag}视频`);
        }
      }
    }
  }

  // 3. Category labels if descriptive
  for (const video of videos) {
    if (
      video.categoryLabel &&
      !['平静视频', '焦虑诱发', '抑郁诱发', '恐惧诱发', 'uncategorized'].includes(
        video.categoryLabel,
      )
    ) {
      const cleanCat = video.categoryLabel.replace(/绝境|永别|悬念/g, '');
      add(`播放${cleanCat}视频`);
    }
  }

  return candidates;
}

export function getLocalRegulationPromptExamples(
  phase: AgentPhase,
  random: () => number = Math.random,
): string[] {
  if (phase === 'video_regulation') {
    const currentVideos = getCurrentRegulationVideos();
    if (currentVideos.length > 0) {
      const candidates = extractVideoTagPromptCandidates(currentVideos);
      if (candidates.length > 0) {
        const pool = [...candidates];
        const selected: string[] = [];
        while (selected.length < 2 && pool.length > 0) {
          const index = Math.floor(random() * pool.length);
          selected.push(pool.splice(index, 1)[0]);
        }
        return selected;
      }
    }
  }

  const pool = localRegulationPromptPools[phase] ?? [];
  const candidates = [...pool];
  const selected: string[] = [];

  while (selected.length < 2 && candidates.length > 0) {
    const index = Math.floor(random() * candidates.length);
    selected.push(candidates.splice(index, 1)[0]);
  }

  return selected;
}

export function getAgentPhaseForRoute(
  pathname: string,
  previousPhase: AgentPhase = 'intro',
): AgentPhase {
  if (pathname === '/home') {
    return previousPhase === 'finish' || previousPhase === 'recovery' ? 'finish' : 'intro';
  }

  if (pathname === '/experiment-settings') {
    return previousPhase === 'music_regulation' || previousPhase === 'recovery'
      ? 'recovery'
      : 'baseline';
  }
  if (pathname === '/eeg-acquisition') {
    return previousPhase === 'music_regulation' || previousPhase === 'recovery'
      ? 'recovery'
      : 'baseline';
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
