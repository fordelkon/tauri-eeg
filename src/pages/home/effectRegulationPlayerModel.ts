import type { VideoRegulationAsset } from '../../video/videoRegulationCatalog';

/**
 * Pure helpers for the embedded regulation player that lives inside the
 * condition-step panel (EffectRegulationPlayer.tsx). They are kept out of the
 * .tsx so the node-environment vitest suite can exercise them without
 * mounting React (same split as effectPipeline / effectReportExport).
 */

/** Maximum number of music-history entries the embedded list offers. */
export const MUSIC_HISTORY_PLAYER_LIMIT = 8;

/**
 * To-zero auto pause: the wall-clock window is a hard floor (the same rule
 * that gates the finish button via `regulationFinishModeFromRemaining`), so
 * once the countdown reads exactly 0 the player must stop. A null countdown
 * means the window has not started yet - never a pause condition.
 */
export function shouldPauseAt(remainingSeconds: number | null): boolean {
  return remainingSeconds === 0;
}

/**
 * Index of the default regulation video inside the stable catalog order
 * (the first usable entry). -1 when the catalog is empty so callers can
 * render the empty state instead of indexing.
 */
export function selectDefaultVideoIndex(assets: readonly VideoRegulationAsset[]): number {
  return assets.length > 0 ? 0 : -1;
}

/**
 * Circular prev/next index for the video switcher: stepping past either end
 * wraps around so the operator can cycle the catalog in one card. Returns
 * -1 for an empty catalog (nothing selectable).
 */
export function cycleVideoIndex(currentIndex: number, length: number, delta: 1 | -1): number {
  if (length <= 0) {
    return -1;
  }

  return (((currentIndex + delta) % length) + length) % length;
}

/**
 * Newest-first slice for the embedded music list; the backend command already
 * returns history ordered by created_at DESC, so trimming keeps the most
 * recent entries.
 */
export function trimMusicHistoryForPlayer<T>(
  items: readonly T[],
  limit: number = MUSIC_HISTORY_PLAYER_LIMIT,
): T[] {
  return items.slice(0, Math.max(0, limit));
}

/** `YYYY-MM-DD HH:mm` in local time from an ISO timestamp (blank for invalid). */
export function formatMusicHistoryTime(isoCreatedAt: string): string {
  const date = new Date(isoCreatedAt);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const pad = (value: number) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Operator-facing duration label for one music-history row. */
export function formatMusicDurationLabel(durationSeconds: number | null): string {
  if (durationSeconds === null || !Number.isFinite(durationSeconds)) {
    return '时长未知';
  }

  return `${Math.round(durationSeconds)} 秒`;
}
