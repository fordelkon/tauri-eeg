import { describe, expect, test } from 'vitest';
import type { VideoRegulationAsset } from '../../video/videoRegulationCatalog';
import {
  cycleVideoIndex,
  formatMusicDurationLabel,
  formatMusicHistoryTime,
  selectDefaultVideoIndex,
  shouldPauseAt,
  trimMusicHistoryForPlayer,
} from './effectRegulationPlayerModel';

const videoAsset = (id: string): VideoRegulationAsset => ({
  durationLabel: id,
  hasWater: false,
  id,
  indexedTags: [id],
  segment: {
    atmosphere: '平静',
    colorTone: '灰调',
    hasWater: false,
    scene: id,
    tags: [],
    weather: '阴天',
  },
  sourcePath: `C:\\video_database\\${id}.mp4`,
  summary: id,
  tags: [],
  title: id,
});

describe('shouldPauseAt (embedded player to-zero auto pause)', () => {
  test('pauses only when the countdown reached exactly zero', () => {
    expect(shouldPauseAt(0)).toBe(true);
    expect(shouldPauseAt(1)).toBe(false);
    expect(shouldPauseAt(600)).toBe(false);
  });

  test('never pauses on a null countdown (window not started)', () => {
    expect(shouldPauseAt(null)).toBe(false);
  });
});

describe('selectDefaultVideoIndex (first usable catalog entry)', () => {
  test('picks the first entry of a non-empty catalog', () => {
    expect(selectDefaultVideoIndex([videoAsset('a'), videoAsset('b')])).toBe(0);
    expect(selectDefaultVideoIndex([videoAsset('a')])).toBe(0);
  });

  test('returns -1 for an empty catalog so callers render the empty state', () => {
    expect(selectDefaultVideoIndex([])).toBe(-1);
  });
});

describe('cycleVideoIndex (prev/next circular switcher)', () => {
  test('steps forward and wraps past the end', () => {
    expect(cycleVideoIndex(0, 3, 1)).toBe(1);
    expect(cycleVideoIndex(1, 3, 1)).toBe(2);
    expect(cycleVideoIndex(2, 3, 1)).toBe(0);
  });

  test('steps backward and wraps past the start', () => {
    expect(cycleVideoIndex(2, 3, -1)).toBe(1);
    expect(cycleVideoIndex(0, 3, -1)).toBe(2);
  });

  test('stays on the single entry of a one-item catalog', () => {
    expect(cycleVideoIndex(0, 1, 1)).toBe(0);
    expect(cycleVideoIndex(0, 1, -1)).toBe(0);
  });

  test('returns -1 for an empty catalog', () => {
    expect(cycleVideoIndex(0, 0, 1)).toBe(-1);
    expect(cycleVideoIndex(0, 0, -1)).toBe(-1);
  });
});

describe('trimMusicHistoryForPlayer (most recent entries first)', () => {
  test('keeps at most 8 entries by default (backend already sorts DESC)', () => {
    const items = Array.from({ length: 12 }, (_unused, index) => `item-${index}`);

    const trimmed = trimMusicHistoryForPlayer(items);

    expect(trimmed).toHaveLength(8);
    expect(trimmed[0]).toBe('item-0');
    expect(trimmed[7]).toBe('item-7');
  });

  test('honors a custom limit and tolerates shorter/empty lists', () => {
    expect(trimMusicHistoryForPlayer(['a'], 8)).toEqual(['a']);
    expect(trimMusicHistoryForPlayer([], 8)).toEqual([]);
    expect(trimMusicHistoryForPlayer(['a', 'b'], 1)).toEqual(['a']);
  });
});

describe('music history row labels', () => {
  test('formats a local timestamp without seconds', () => {
    // Zone-less ISO parses as local time, so the label is deterministic.
    expect(formatMusicHistoryTime('2026-09-05T10:30:00')).toBe('2026-09-05 10:30');
    expect(formatMusicHistoryTime('not-a-date')).toBe('');
  });

  test('formats the duration label with an unknown fallback', () => {
    expect(formatMusicDurationLabel(30)).toBe('30 秒');
    expect(formatMusicDurationLabel(30.4)).toBe('30 秒');
    expect(formatMusicDurationLabel(null)).toBe('时长未知');
  });
});
