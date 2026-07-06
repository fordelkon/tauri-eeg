import { describe, expect, it } from 'vitest';
import { addAgentTimelineEntry, getLatestPersonalizedAnswer, normalizePersonalizedAnswer } from './agentContext';

describe('agentContext', () => {
  it('normalizes short personalized answers into bounded tags', () => {
    const answer = normalizePersonalizedAnswer('music_regulation', '我想要轻柔钢琴，不要人声', 1000);

    expect(answer).toEqual({
      phase: 'music_regulation',
      answer: '我想要轻柔钢琴，不要人声',
      normalizedTags: ['piano', 'avoid_vocals', 'soft'],
      createdAt: 1000,
    });
  });

  it('keeps an in-memory timeline without mutating the original list', () => {
    const original = [{ at: 1, phase: 'intro' as const, type: 'message' as const, text: '开始' }];
    const next = addAgentTimelineEntry(original, {
      at: 2,
      phase: 'baseline',
      type: 'action',
      text: '开始基线采集',
    });

    expect(original).toHaveLength(1);
    expect(next).toHaveLength(2);
  });

  it('returns the latest personalized answer for a phase', () => {
    const latest = getLatestPersonalizedAnswer([
      normalizePersonalizedAnswer('video_regulation', '海岸', 1),
      normalizePersonalizedAnswer('video_regulation', '森林', 2),
    ], 'video_regulation');

    expect(latest?.answer).toBe('森林');
  });
});
