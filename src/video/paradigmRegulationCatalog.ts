import type { ParadigmVideoEntry, ParadigmVideoLibrary } from '../paradigm/types';

export const categoryLabels = new Map([
  ['healing_animation', '治愈动画'],
  ['music', '音乐'],
  ['scenery', '风景'],
  ['sound_relaxation', '声音放松'],
  ['vlog', '日常影像'],
  ['uncategorized', '平静视频'],
  ['anxiety', '焦虑诱发'],
  ['depression', '抑郁诱发'],
  ['fear', '恐惧诱发'],
  ['calm', '平静视频'],
  ['space_crisis', '舱室与心理危机'],
  ['confined_space', '狭窄密闭绝境'],
  ['conflict', '人际心理对抗'],
  ['escape', '危机灾难逃生'],
  ['bereavement', '亲人离丧永别'],
  ['isolation', '社会退缩孤立'],
  ['solitude', '独处消沉凝视'],
  ['struggle', '现实重压挫折'],
  ['dark_room', '封闭暗室惊悚'],
  ['haunted_house', '阴森古宅悬念'],
]);

export type EmotionKey = 'calm' | 'anxiety' | 'depression' | 'fear';

export const emotionDisplayLabels: Record<string, string> = {
  calm: '平静',
  anxiety: '焦虑',
  depression: '抑郁',
  fear: '恐惧',
};

export type RegulationVideo = {
  id: string;
  title: string;
  sourcePath: string;
  relativePath: string;
  category: string;
  categoryLabel: string;
  emotion?: 'calm' | 'anxiety' | 'depression' | 'fear';
  emotionLabel?: string;
  hasWater?: boolean;
  sceneLabel?: string;
  tags?: string[];
};

export function buildRegulationVideos(
  entries: readonly ParadigmVideoEntry[],
  emotion?: 'calm' | 'anxiety' | 'depression' | 'fear',
): RegulationVideo[] {
  return entries.map((entry) => {
    const relativePath = entry.fileName.replace(/\\/g, '/');
    const parts = relativePath.split('/');
    const defaultUncategorized = emotion
      ? emotion === 'calm'
        ? 'uncategorized'
        : emotion
      : 'uncategorized';
    const defaultUncategorizedLabel = emotion
      ? emotion === 'calm'
        ? '平静视频'
        : emotionDisplayLabels[emotion] ?? '素材'
      : '平静视频';

    let category = parts.length > 1 ? parts[0] : defaultUncategorized;
    let categoryLabel =
      categoryLabels.get(category) ??
      (category === 'uncategorized' ? defaultUncategorizedLabel : category);

    let sceneLabel = '';
    let hasWater = false;
    const tags: string[] = [];

    const fileName = parts[parts.length - 1];
    const baseName = fileName.replace(/\.mp4$/i, '');
    const num = parseInt(baseName.replace(/\D/g, ''), 10);

    if (emotion === 'anxiety') {
      if (!Number.isNaN(num)) {
        if (num <= 10) {
          category = 'space_crisis';
          sceneLabel = '太空舱室绝境';
          tags.push('焦虑', '科技', '心理危机');
        } else if (num <= 25) {
          category = 'confined_space';
          sceneLabel = '狭窄密闭绝境';
          tags.push('幽暗', '密闭', '窒息感');
        } else if (num <= 38) {
          category = 'conflict';
          sceneLabel = '人际心理对抗';
          tags.push('紧张', '压抑', '人际冲突');
        } else {
          category = 'escape';
          sceneLabel = '危机灾难逃生';
          tags.push('灾难', '逃生', '紧迫');
        }
        categoryLabel = categoryLabels.get(category) ?? categoryLabel;
      }
    } else if (emotion === 'depression') {
      if (!Number.isNaN(num)) {
        if (num <= 12) {
          category = 'bereavement';
          sceneLabel = '亲人离丧永别';
          tags.push('悲伤', '离别', '沉郁');
        } else if (num <= 25) {
          category = 'isolation';
          sceneLabel = '社会退缩孤立';
          tags.push('苍凉', '孤立', '无助');
        } else if (num <= 38) {
          category = 'solitude';
          sceneLabel = '独处消沉凝视';
          tags.push('空虚', '独处', '消沉');
        } else {
          category = 'struggle';
          sceneLabel = '现实重压挫折';
          tags.push('重压', '挫折', '压抑');
        }
        categoryLabel = categoryLabels.get(category) ?? categoryLabel;
      }
    } else if (emotion === 'fear') {
      if (!Number.isNaN(num)) {
        if (num % 2 === 1) {
          category = 'dark_room';
          sceneLabel = '封闭暗室惊悚';
          tags.push('惊悚', '悬疑', '未知');
        } else {
          category = 'haunted_house';
          sceneLabel = '阴森古宅悬念';
          tags.push('古宅', '超自然', '诡异');
        }
        categoryLabel = categoryLabels.get(category) ?? categoryLabel;
      }
    } else if (emotion === 'calm' || !emotion) {
      if (category === 'scenery') {
        if (!Number.isNaN(num) && [4, 5, 8, 9, 12, 14, 15, 17].includes(num)) {
          hasWater = true;
          sceneLabel = '海岸浪花';
          tags.push('海景', '水面', '浪花');
        } else {
          sceneLabel = '高山流云';
          tags.push('群山', '云海', '自然');
        }
      } else if (category === 'sound_relaxation') {
        hasWater = true;
        sceneLabel = '水流雨声';
        tags.push('风雨', '水面', '清幽');
      } else if (category === 'healing_animation') {
        sceneLabel = '童话治愈';
        tags.push('手绘', '童话', '温暖');
      } else if (category === 'music') {
        sceneLabel = '星空天际';
        tags.push('星空', '黄昏', '悠远');
      } else if (category === 'vlog') {
        sceneLabel = '生活居室';
        tags.push('居家', '素雅', '日常');
      }
    }

    const item: RegulationVideo = {
      id: entry.videoId,
      title: baseName,
      sourcePath: entry.absolutePath,
      relativePath,
      category,
      categoryLabel,
    };

    if (emotion) {
      item.emotion = emotion;
      item.emotionLabel = emotionDisplayLabels[emotion];
      if (sceneLabel) item.sceneLabel = sceneLabel;
      if (hasWater) item.hasWater = hasWater;
      if (tags.length > 0) item.tags = tags;
    }

    return item;
  });
}

export function buildAllRegulationVideos(
  library: Partial<ParadigmVideoLibrary> | null | undefined,
): RegulationVideo[] {
  if (!library) return [];
  const emotions = ['calm', 'anxiety', 'depression', 'fear'] as const;
  const all: RegulationVideo[] = [];
  for (const emotion of emotions) {
    const entries = library[emotion] ?? [];
    all.push(...buildRegulationVideos(entries, emotion));
  }
  return all;
}

export function getEmotionSummary(videos: readonly RegulationVideo[]) {
  const counts: Record<EmotionKey, number> = {
    calm: 0,
    anxiety: 0,
    depression: 0,
    fear: 0,
  };
  for (const video of videos) {
    if (video.emotion && video.emotion in counts) {
      counts[video.emotion] += 1;
    }
  }
  return [
    { value: 'calm' as EmotionKey, label: '平静', count: counts.calm },
    { value: 'anxiety' as EmotionKey, label: '焦虑', count: counts.anxiety },
    { value: 'depression' as EmotionKey, label: '抑郁', count: counts.depression },
    { value: 'fear' as EmotionKey, label: '恐惧', count: counts.fear },
  ];
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
  emotion?: string,
  hasWaterOnly?: boolean,
) {
  const search = query.trim().toLocaleLowerCase();
  return videos.filter((video) => {
    if (emotion && emotion !== 'all' && video.emotion && video.emotion !== emotion) {
      return false;
    }
    if (category && video.category !== category) {
      return false;
    }
    if (hasWaterOnly && !video.hasWater) {
      return false;
    }
    if (!search) return true;
    const haystack = `${video.title} ${video.relativePath} ${video.categoryLabel} ${video.emotionLabel ?? ''} ${video.sceneLabel ?? ''} ${(video.tags ?? []).join(' ')}`.toLocaleLowerCase();
    return haystack.includes(search);
  });
}
