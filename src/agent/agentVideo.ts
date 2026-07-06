import {
  getAllVideoRegulationAssets,
  type VideoRegulationAsset,
} from '../video/videoRegulationCatalog';
import { normalizeAgentInput } from './agentIntent';

export type AgentVideoMatch =
  | { status: 'matched'; video: VideoRegulationAsset; confidence: 'exact' | 'nearest'; message: string }
  | { status: 'unavailable'; message: string };

const safeAliases: Record<string, string[]> = {
  '9_seg016': ['暮色海岸', '海岸黄昏', '温柔海岸'],
};

export function findAgentVideoMatch(
  input: string,
  catalog: readonly VideoRegulationAsset[] = getAllVideoRegulationAssets(),
): AgentVideoMatch {
  if (catalog.length === 0) {
    return {
      status: 'unavailable',
      message: '当前没有可用视频素材。',
    };
  }

  const query = normalizeAgentInput(input).replace(/播放|视频|放松/g, '');
  const aliasMatched = catalog.find((video) => (
    safeAliases[video.id]?.some((alias) => query.length > 0 && alias.includes(query))
  ));
  const matched = aliasMatched ?? catalog.find((video) => {
    const searchable = getSearchTerms(video).join('');

    return query.length > 0 && searchable.includes(query);
  });

  if (matched) {
    return {
      status: 'matched',
      video: matched,
      confidence: 'exact',
      message: `已找到视频：${displayVideoTitle(matched)}`,
    };
  }

  const nearest = pickNearestVideo(query, catalog);
  return {
    status: 'matched',
    video: nearest,
    confidence: 'nearest',
    message: `没有找到精确匹配视频，已选择最接近素材：${displayVideoTitle(nearest)}`,
  };
}

function pickNearestVideo(query: string, catalog: readonly VideoRegulationAsset[]): VideoRegulationAsset {
  if (!query) {
    return catalog[0];
  }

  const scored = catalog.map((video, index) => {
    const terms = getSearchTerms(video);
    const score = terms.filter((term) => query.includes(term) || term.includes(query)).length;
    return { video, index, score };
  });

  scored.sort((left, right) => right.score - left.score || left.index - right.index);
  return scored[0].video;
}

function displayVideoTitle(video: VideoRegulationAsset): string {
  return safeAliases[video.id]?.[0] ?? video.title;
}

function getSearchTerms(video: VideoRegulationAsset): string[] {
  return [
    video.title,
    video.summary,
    video.segment.scene,
    video.segment.atmosphere,
    ...video.tags,
    ...video.indexedTags,
    ...(safeAliases[video.id] ?? []),
  ];
}
