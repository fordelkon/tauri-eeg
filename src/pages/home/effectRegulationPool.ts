import type { ParadigmVideoEntry } from '../../paradigm/types';

/** Calm material is reserved for the video-regulation leg of the evaluation. */
export type RegulationPoolStatus =
  | { kind: 'ready'; entries: readonly ParadigmVideoEntry[] }
  | { kind: 'blocked'; copy: string };

/**
 * The effect-evaluation flow may only begin a video regulation window after
 * the shared paradigm library has yielded a playable calm pool. This keeps
 * the regulation clock from consuming time while the stimulus is unavailable.
 */
export function describeRegulationPoolStatus(
  pool: readonly ParadigmVideoEntry[] | null,
): RegulationPoolStatus {
  if (pool == null || pool.length === 0) {
    return {
      kind: 'blocked',
      copy: '尚未加载有效的平静调控素材库（video_paradigm/Calm），无法开始视频调控。请先在实验设置页检查素材库。',
    };
  }

  return { kind: 'ready', entries: pool };
}
