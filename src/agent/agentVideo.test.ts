import { describe, expect, it } from 'vitest';
import { findAgentVideoMatch } from './agentVideo';

describe('agentVideo', () => {
  it('finds an existing video by indexed Chinese catalog text', () => {
    const result = findAgentVideoMatch('播放暮色海岸视频');

    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.confidence).toBe('exact');
      expect(result.video.id).toBe('9_seg016');
    }
  });

  it('returns the nearest finite catalog video when no exact material exists', () => {
    const result = findAgentVideoMatch('播放火山城市视频');

    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.confidence).toBe('nearest');
      expect(result.video).toBeDefined();
    }
  });

  it('only reports unavailable when the finite catalog is empty', () => {
    const result = findAgentVideoMatch('播放火山城市视频', []);

    expect(result).toEqual({
      status: 'unavailable',
      message: '当前没有可用视频素材。',
    });
  });
});
