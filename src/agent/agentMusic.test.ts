import { describe, expect, it } from 'vitest';
import { buildAgentMusicPreview, sanitizeMusicCustomDescription } from './agentMusic';

describe('agentMusic', () => {
  it('builds constrained calm music params from requested tags', () => {
    const preview = buildAgentMusicPreview({
      personalizedTags: ['piano', 'avoid_vocals'],
      customDescription: '轻柔钢琴，慢速',
    });

    expect(preview.params.duration).toBe(30);
    expect(preview.params.prompt).toContain('calm instrumental');
    expect(preview.params.prompt).toContain('piano');
    expect(preview.params.negativePrompt).toBe('vocals, singing, speech, lyrics');
    expect(preview.requiresConfirmation).toBe(true);
  });

  it('preserves planner-provided music style and detail tags in the prompt', () => {
    const preview = buildAgentMusicPreview({
      personalizedTags: ['lo-fi instrumental', 'warm vinyl texture'],
    });

    expect(preview.params.prompt).toContain('lo-fi instrumental');
    expect(preview.params.prompt).toContain('warm vinyl texture');
  });

  it('filters vocal and harsh custom descriptions', () => {
    expect(sanitizeMusicCustomDescription('加入人声歌词和尖锐恐怖音效')).toEqual({
      accepted: false,
      reason: '自定义描述包含不适合调控音乐的内容。',
    });
  });
});
