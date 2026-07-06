import type { AgentPhase } from './agentFlow';

export type AgentCoreScores = {
  anxiety: number;
  worry: number;
  mood: number;
  energy: number;
};

export type AgentPersonalizedAnswer = {
  phase: AgentPhase;
  answer: string;
  normalizedTags: string[];
  createdAt: number;
};

export type AgentTimelineEntry = {
  at: number;
  phase: AgentPhase;
  type: 'message' | 'action' | 'planner' | 'confirmation';
  text: string;
};

const tagMatchers: Array<[RegExp, string]> = [
  [/钢琴|piano/i, 'piano'],
  [/不要人声|无人声|无歌词|avoid vocals|no vocals/i, 'avoid_vocals'],
  [/轻柔|柔和|soft|gentle/i, 'soft'],
  [/海岸|海边|海|coast|ocean/i, 'coast'],
  [/森林|树林|forest/i, 'forest'],
  [/慢|slow/i, 'slow'],
];

export function normalizePersonalizedAnswer(
  phase: AgentPhase,
  answer: string,
  createdAt = Date.now(),
): AgentPersonalizedAnswer {
  const trimmed = answer.trim().slice(0, 160);
  const normalizedTags = tagMatchers
    .filter(([pattern]) => pattern.test(trimmed))
    .map(([, tag]) => tag);

  return {
    phase,
    answer: trimmed,
    normalizedTags: Array.from(new Set(normalizedTags)),
    createdAt,
  };
}

export function addAgentTimelineEntry(
  entries: readonly AgentTimelineEntry[],
  entry: AgentTimelineEntry,
): AgentTimelineEntry[] {
  return [...entries, entry].slice(-20);
}

export function getLatestPersonalizedAnswer(
  answers: readonly AgentPersonalizedAnswer[],
  phase: AgentPhase,
): AgentPersonalizedAnswer | null {
  return [...answers].reverse().find((answer) => answer.phase === phase) ?? null;
}
