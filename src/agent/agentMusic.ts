import type { AgentCoreScores } from './agentContext';

export type AgentMusicInput = {
  coreScores: AgentCoreScores;
  personalizedTags?: readonly string[];
  customDescription?: string;
};

export type AgentMusicPreview = {
  params: {
    prompt: string;
    negativePrompt: string;
    duration: number;
  };
  requiresConfirmation: true;
};

export type CustomDescriptionResult =
  | { accepted: true; value: string }
  | { accepted: false; reason: string };

const blockedDescriptionPattern = /人声|歌词|演唱|说话|尖锐|恐怖|暴力|惊吓|vocal|lyrics|speech|harsh|scary|violent/i;
const negativePrompt = 'vocals, singing, speech, lyrics';
const controlTags = new Set(['avoid_vocals', 'no vocals']);

export function sanitizeMusicCustomDescription(description: string): CustomDescriptionResult {
  const value = description.trim().slice(0, 120);

  if (!value) {
    return { accepted: true, value: '' };
  }

  if (blockedDescriptionPattern.test(value)) {
    return {
      accepted: false,
      reason: '自定义描述包含不适合调控音乐的内容。',
    };
  }

  return { accepted: true, value };
}

export function buildAgentMusicPreview(input: AgentMusicInput): AgentMusicPreview {
  const { coreScores, personalizedTags = [] } = input;
  const custom = sanitizeMusicCustomDescription(input.customDescription ?? '');
  const plannerTags = personalizedTags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && !controlTags.has(tag.toLowerCase()) && !blockedDescriptionPattern.test(tag));
  const parts = [
    coreScores.anxiety >= 70 || coreScores.worry >= 70 ? 'ambient instrumental' : 'calm instrumental',
    coreScores.energy <= 35 ? 'warm low energy texture' : 'stable slow rhythm',
    personalizedTags.includes('piano') ? 'piano' : '',
    personalizedTags.includes('soft') ? 'soft dynamics' : '',
    ...plannerTags,
    custom.accepted ? custom.value : '',
  ].filter((part) => part.length > 0);

  return {
    params: {
      prompt: Array.from(new Set(parts)).join(', '),
      negativePrompt,
      duration: 30,
    },
    requiresConfirmation: true,
  };
}
