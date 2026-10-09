import { afterEach, describe, expect, it } from 'vitest';
import { findAgentVideoMatch } from './agentVideo';
import { buildRegulationVideos } from '../video/paradigmRegulationCatalog';
import { setCurrentRegulationVideos } from '../video/regulationVideoResources';

const videos = buildRegulationVideos([
  { videoId: 'scenery/calm_vid01', fileName: 'scenery/calm_vid01.mp4', absolutePath: 'C:/Calm/scenery/calm_vid01.mp4' },
  { videoId: 'music/calm_vid02', fileName: 'music/calm_vid02.mp4', absolutePath: 'C:/Calm/music/calm_vid02.mp4' },
]);
afterEach(() => setCurrentRegulationVideos([]));

describe('agentVideo', () => {
  it('finds an existing video by its loaded folder category', () => {
    setCurrentRegulationVideos(videos);
    const result = findAgentVideoMatch('播放风景视频');

    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.confidence).toBe('exact');
      expect(result.video.id).toBe('scenery/calm_vid01');
    }
  });

  it('returns the nearest finite catalog video when no exact material exists', () => {
    setCurrentRegulationVideos(videos);
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

  it('does not fall back to invented assets when no directory is loaded', () => {
    expect(findAgentVideoMatch('播放暮色海岸视频')).toEqual({ status: 'unavailable', message: '当前没有可用视频素材。' });
  });
});
