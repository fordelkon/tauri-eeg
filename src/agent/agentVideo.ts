import type { RegulationVideo } from '../video/paradigmRegulationCatalog';
import { getCurrentRegulationVideos } from '../video/regulationVideoResources';
import { normalizeAgentInput } from './agentIntent';

export type AgentVideoMatch =
  | { status: 'matched'; video: RegulationVideo; confidence: 'exact' | 'nearest'; message: string }
  | { status: 'unavailable'; message: string };

export function findAgentVideoMatch(
  input: string,
  catalog: readonly RegulationVideo[] = getCurrentRegulationVideos(),
): AgentVideoMatch {
  if (catalog.length === 0) {
    return {
      status: 'unavailable',
      message: '当前没有可用视频素材。',
    };
  }

  const query = normalizeAgentInput(input).replace(/播放|视频|放松/g, '');
  const matched = catalog.find((video) => {
    const searchable = getSearchTerms(video).join('');

    return query.length > 0 && searchable.includes(query);
  });

  if (matched) {
    return {
      status: 'matched',
      video: matched,
      confidence: 'exact',
      message: `已找到视频：${matched.title}`,
    };
  }

  const nearest = pickNearestVideo(query, catalog);
  return {
    status: 'matched',
    video: nearest,
    confidence: 'nearest',
    message: `没有找到精确匹配视频，已选择最接近素材：${nearest.title}`,
  };
}

function pickNearestVideo(query: string, catalog: readonly RegulationVideo[]): RegulationVideo {
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

function getSearchTerms(video: RegulationVideo): string[] {
  return [video.title, video.relativePath, video.categoryLabel];
}
