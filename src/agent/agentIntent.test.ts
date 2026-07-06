import { describe, expect, it } from 'vitest';
import { classifyAgentIntent, normalizeAgentInput } from './agentIntent';

describe('agentIntent', () => {
  it('normalizes whitespace and common punctuation', () => {
    expect(normalizeAgentInput('  开始，基线采集！')).toBe('开始基线采集');
  });

  it('classifies subject prompts into constrained intents', () => {
    expect(classifyAgentIntent('开始实验')).toBe('go_next_page');
    expect(classifyAgentIntent('下一步')).toBe('go_next_page');
    expect(classifyAgentIntent('开始基线采集')).toBe('start_eeg_device_and_record');
    expect(classifyAgentIntent('停止并保存')).toBe('stop_and_save_eeg_recording');
    expect(classifyAgentIntent('播放放松视频')).toBe('play_video');
    expect(classifyAgentIntent('生成舒缓音乐')).toBe('generate_music');
    expect(classifyAgentIntent('跳过游戏')).toBe('skip_game');
  });

  it('returns unknown for unsupported free-form operations', () => {
    expect(classifyAgentIntent('删除所有数据')).toBe('unknown');
  });
});
