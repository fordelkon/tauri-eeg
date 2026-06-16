import { describe, expect, it } from 'vitest';
import {
  getDefaultVideoSelections,
  getNextVideoSelectionStep,
  getVideoRegulationCatalog,
  getVideoSelectionOptions,
  selectFirstMatchedVideo,
  toPlayableVideoUrl,
  videoSelectionSteps,
} from './videoRegulationCatalog';

describe('videoRegulationCatalog', () => {
  it('loads local segment videos from the video library tags index', () => {
    const videos = getVideoRegulationCatalog({
      ...getDefaultVideoSelections(),
      scene: '密林深处',
    });

    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      id: '14_seg000',
      sourcePath: 'D:\\tauri-eeg\\video_database\\14_seg000.mp4',
      title: '密林深处',
    });
  });

  it('does not show videos before a tag selection starts', () => {
    expect(getVideoRegulationCatalog(getDefaultVideoSelections())).toEqual([]);
  });

  it('filters a caller supplied video library', () => {
    const customAsset = {
      durationLabel: 'custom.mp4 / custom_seg000',
      hasWater: false,
      id: 'custom_seg000',
      indexedTags: ['自定义标签', '自定义氛围', '自定义场景'],
      segment: {
        atmosphere: '自定义氛围',
        colorTone: '自定义色调',
        hasWater: false,
        scene: '自定义场景',
        tags: ['自定义标签'],
        weather: '自定义天气',
      },
      sourcePath: 'E:\\custom\\custom_seg000.mp4',
      summary: '自定义场景，自定义天气，自定义氛围，自定义色调',
      tags: ['自定义标签'],
      title: '自定义场景',
    };

    expect(getVideoSelectionOptions(getDefaultVideoSelections(), 'tag', [customAsset])).toEqual([
      { label: '自定义标签', value: '自定义标签' },
    ]);
    expect(
      getVideoRegulationCatalog(
        { ...getDefaultVideoSelections(), tag: '自定义标签', atmosphere: '自定义氛围', scene: '自定义场景' },
        [customAsset],
      ),
    ).toEqual([customAsset]);
  });

  it('exposes step options from existing video_library_tags metadata', () => {
    const selections = getDefaultVideoSelections();

    expect(getVideoSelectionOptions(selections, 'scene').map((option) => option.value)).toEqual([
      '密林深处',
      '海岸云天',
      '海岸暮色',
      '浓雾密林',
      '山林植被',
      '海天一色',
      '阴天海景',
      '海岸礁石',
      '海滩山景',
      '礁石海岸',
      '秋叶金黄',
      '海岸远眺',
      '薄雾森林',
      '暗调森林',
      '山谷薄雾',
      '风雨海景',
      '山林薄雾',
      '雾锁群山',
      '海岸灰调',
      '浓雾森林',
      '山谷云雾',
      '暮色海岸',
      '天际云海',
      '平静海岸',
      '山谷暮色',
    ]);

    const afterScene = { ...selections, scene: '暮色海岸' };
    expect(getVideoSelectionOptions(afterScene, 'atmosphere').map((option) => option.value)).toEqual(['温柔浪漫']);
    expect(getVideoSelectionOptions(afterScene, 'tag').map((option) => option.value)).toEqual([
      '海岸',
      '黄昏',
      '温柔',
      '暖蓝',
      '码头',
    ]);
  });

  it('filters progressively and selects the first matched video for playback', () => {
    const selections = {
      ...getDefaultVideoSelections(),
      atmosphere: '温柔浪漫',
      scene: '暮色海岸',
      tag: '码头',
    };

    expect(getVideoRegulationCatalog(selections).map((video) => video.id)).toEqual(['9_seg016']);
    expect(selectFirstMatchedVideo(selections)?.sourcePath).toBe(
      'D:\\tauri-eeg\\video_database\\9_seg016.mp4',
    );
    expect(getNextVideoSelectionStep(selections)).toBeNull();
  });

  it('reports the next missing selection step', () => {
    expect(videoSelectionSteps).toEqual(['tag', 'atmosphere', 'scene']);
    expect(getNextVideoSelectionStep(getDefaultVideoSelections())).toBe('tag');
    expect(getNextVideoSelectionStep({ ...getDefaultVideoSelections(), tag: '码头' })).toBe('atmosphere');
    expect(getNextVideoSelectionStep({ ...getDefaultVideoSelections(), tag: '码头', atmosphere: '温柔浪漫' })).toBe('scene');
  });

  it('converts a Windows path into a playable local video URL', () => {
    expect(toPlayableVideoUrl('D:\\tauri-eeg\\video_database\\14_seg000.mp4')).toBe(
      'file:///D:/tauri-eeg/video_database/14_seg000.mp4',
    );
  });

  it('uses an injected Tauri file converter when one is provided', () => {
    expect(toPlayableVideoUrl('D:\\tauri-eeg\\video_database\\14_seg000.mp4', (path) => `asset://${path}`)).toBe(
      'asset://D:\\tauri-eeg\\video_database\\14_seg000.mp4',
    );
  });
});
