import { describe, expect, it } from 'vitest';
import { classifyAgentIntent, normalizeAgentInput } from './agentIntent';

describe('agentIntent', () => {
  it('opens the current experiment pages without starting external recording', () => {
    expect(classifyAgentIntent('打开实验范式')).toBe('open_paradigm');
    expect(classifyAgentIntent('打开实验设置')).toBe('open_experiment_settings');
  });
  it('normalizes whitespace and common punctuation', () => {
    expect(normalizeAgentInput('  打开，实验设置！')).toBe('打开实验设置');
  });

  it('classifies subject prompts into constrained intents', () => {
    expect(classifyAgentIntent('开始实验')).toBe('go_next_page');
    expect(classifyAgentIntent('下一步')).toBe('go_next_page');
    expect(classifyAgentIntent('打开实验设置')).toBe('open_experiment_settings');
    expect(classifyAgentIntent('播放放松视频')).toBe('play_video');
    expect(classifyAgentIntent('生成舒缓音乐')).toBe('generate_music');
    expect(classifyAgentIntent('跳过游戏')).toBe('skip_game');
  });

  it('returns unknown for unsupported free-form operations', () => {
    expect(classifyAgentIntent('删除所有数据')).toBe('unknown');
  });
});
