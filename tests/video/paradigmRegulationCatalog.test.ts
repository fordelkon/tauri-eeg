import { describe, expect, test } from 'vitest';
import { buildRegulationVideos, filterRegulationVideos, getRegulationCategories } from '../../src/video/paradigmRegulationCatalog';
import type { ParadigmVideoEntry } from '../../src/paradigm/types';

const entries: ParadigmVideoEntry[] = [
  { videoId: 'scenery/calm_vid01', fileName: 'scenery/calm_vid01.mp4', absolutePath: 'C:\\videos\\Calm\\scenery\\calm_vid01.mp4' },
  { videoId: 'music/calm_vid01', fileName: 'music/calm_vid01.mp4', absolutePath: 'C:\\videos\\Calm\\music\\calm_vid01.mp4' },
  { videoId: 'sound_relaxation/sub/nature', fileName: 'sound_relaxation\\sub\\nature.MP4', absolutePath: 'C:\\videos\\Calm\\sound_relaxation\\sub\\nature.MP4' },
  { videoId: 'plain', fileName: 'plain.mp4', absolutePath: 'C:\\videos\\Calm\\plain.mp4' },
];

describe('folder-based regulation catalog', () => {
  test('uses real file identity and path, retaining same filenames in different folders', () => {
    const videos = buildRegulationVideos(entries);
    expect(videos.slice(0, 2)).toEqual([
      { id: 'scenery/calm_vid01', title: 'calm_vid01', sourcePath: entries[0].absolutePath,
        relativePath: 'scenery/calm_vid01.mp4', category: 'scenery', categoryLabel: '风景' },
      { id: 'music/calm_vid01', title: 'calm_vid01', sourcePath: entries[1].absolutePath,
        relativePath: 'music/calm_vid01.mp4', category: 'music', categoryLabel: '音乐' },
    ]);
    expect(videos[2]).toMatchObject({ title: 'nature', categoryLabel: '声音放松', relativePath: 'sound_relaxation/sub/nature.MP4' });
    expect(videos[3]).toMatchObject({ category: 'uncategorized', categoryLabel: '平静视频' });
  });

  test('shows only existing folders with their actual counts', () => {
    const videos = buildRegulationVideos([...entries, { ...entries[0], videoId: 'scenery/second', fileName: 'scenery/second.mp4' }]);
    expect(getRegulationCategories(videos)).toEqual([
      { value: 'scenery', label: '风景', count: 2 }, { value: 'music', label: '音乐', count: 1 },
      { value: 'sound_relaxation', label: '声音放松', count: 1 }, { value: 'uncategorized', label: '平静视频', count: 1 },
    ]);
    expect(getRegulationCategories(buildRegulationVideos([]))).toEqual([]);
  });

  test('searches real filenames, folder paths and labels together with category filtering', () => {
    const videos = buildRegulationVideos(entries);
    expect(filterRegulationVideos(videos, '', ' CALM_VID01 ').map(video => video.id)).toEqual(['scenery/calm_vid01', 'music/calm_vid01']);
    expect(filterRegulationVideos(videos, 'music', 'calm').map(video => video.id)).toEqual(['music/calm_vid01']);
    expect(filterRegulationVideos(videos, '', '声音放松').map(video => video.id)).toEqual(['sound_relaxation/sub/nature']);
    expect(filterRegulationVideos(videos, '', 'sub/nature').map(video => video.id)).toEqual(['sound_relaxation/sub/nature']);
    expect(filterRegulationVideos(videos, '', '')).toEqual(videos);
    expect(filterRegulationVideos(videos, 'scenery', '不存在')).toEqual([]);
  });

  test.each(['custom', 'constructor', '__proto__'])('retains unknown real folder %s without inventing content tags', category => {
    const videos = buildRegulationVideos([{ videoId: `${category}/a`, fileName: `${category}/a.mp4`, absolutePath: `/videos/Calm/${category}/a.mp4` }]);
    expect(getRegulationCategories(videos)).toEqual([{ value: category, label: category, count: 1 }]);
  });
});
