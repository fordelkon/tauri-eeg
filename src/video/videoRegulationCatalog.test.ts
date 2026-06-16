import { describe, expect, it } from 'vitest';
import {
  getDefaultVideoSelections,
  getVideoRegulationCatalog,
  toPlayableVideoUrl,
} from './videoRegulationCatalog';

describe('videoRegulationCatalog', () => {
  it('seeds the local regulation video for every default tag selection', () => {
    const selections = getDefaultVideoSelections();
    const videos = getVideoRegulationCatalog(selections);

    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      id: 'seed-local-14',
      sourcePath: 'C:\\mp4_videos\\14.mp4',
      title: 'Local Regulation Video 14',
    });
    expect(videos[0].tags.emotionTargets).toContain(selections.emotionTargets[0]);
    expect(videos[0].tags.videoTypes).toContain(selections.videoTypes[0]);
    expect(videos[0].tags.stimulusLevels).toContain(selections.stimulusLevels[0]);
  });

  it('keeps the seed video available for non-default tag combinations during the placeholder phase', () => {
    const videos = getVideoRegulationCatalog({
      emotionTargets: ['reduce-anxiety'],
      stimulusLevels: ['high-stimulus'],
      videoTypes: ['abstract-visual'],
    });

    expect(videos).toHaveLength(1);
    expect(videos[0].sourcePath).toBe('C:\\mp4_videos\\14.mp4');
  });

  it('converts a Windows path into a playable local video URL', () => {
    expect(toPlayableVideoUrl('C:\\mp4_videos\\14.mp4')).toBe('file:///C:/mp4_videos/14.mp4');
  });

  it('uses an injected Tauri file converter when one is provided', () => {
    expect(toPlayableVideoUrl('C:\\mp4_videos\\14.mp4', (path) => `asset://${path}`)).toBe(
      'asset://C:\\mp4_videos\\14.mp4',
    );
  });
});
