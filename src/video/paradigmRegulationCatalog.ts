import type { ParadigmVideoEntry } from '../paradigm/types';

const categoryLabels = new Map([
  ['healing_animation', '治愈动画'],
  ['music', '音乐'],
  ['scenery', '风景'],
  ['sound_relaxation', '声音放松'],
  ['vlog', '日常影像'],
  ['uncategorized', '平静视频'],
]);

export type RegulationVideo = {
  id: string;
  title: string;
  sourcePath: string;
  relativePath: string;
  category: string;
  categoryLabel: string;
};

export function buildRegulationVideos(entries: readonly ParadigmVideoEntry[]): RegulationVideo[] {
  return entries.map((entry) => {
    const relativePath = entry.fileName.replace(/\\/g, '/');
    const parts = relativePath.split('/');
    const category = parts.length > 1 ? parts[0] : 'uncategorized';
    const fileName = parts[parts.length - 1];
    return {
      id: entry.videoId,
      title: fileName.replace(/\.mp4$/i, ''),
      sourcePath: entry.absolutePath,
      relativePath,
      category,
      categoryLabel: categoryLabels.get(category) ?? category,
    };
  });
}

export function getRegulationCategories(videos: readonly RegulationVideo[]) {
  const groups = new Map<string, { value: string; label: string; count: number }>();
  for (const video of videos) {
    const group = groups.get(video.category);
    if (group) group.count += 1;
    else
      groups.set(video.category, { value: video.category, label: video.categoryLabel, count: 1 });
  }
  return [...groups.values()];
}

export function filterRegulationVideos(
  videos: readonly RegulationVideo[],
  category: string,
  query: string,
) {
  const search = query.trim().toLocaleLowerCase();
  return videos.filter(
    (video) =>
      (!category || video.category === category) &&
      `${video.title} ${video.relativePath} ${video.categoryLabel}`
        .toLocaleLowerCase()
        .includes(search),
  );
}
