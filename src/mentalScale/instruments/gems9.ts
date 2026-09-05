/**
 * GEMS-9 (Geneva Emotional Music Scale, 9-dimension short form) — the
 * music-specific add-on scale. Source: Zentner M, Grandjean D, Scherer KR
 * (2008). Emotions evoked by the sound of music: characterization,
 * classification, and measurement. Emotion 8(4):494-521 (GEMS-9: one item
 * per dimension).
 *
 * Spec source: docs/scale-instruments.md §2.5 — nine dimensions rated 1-5 on
 * 完全不同意 → 完全同意 for "刚才的音乐让你感受到下列情绪的程度". The Chinese
 * renderings are research translations (no standard Chinese GEMS-9 exists;
 * doc §2.5 requires noting this in publications).
 *
 * Storage (doc §3.3): GEMS-9 does NOT get its own scale_records row — its
 * answers ride the post battery record as raw_answers.gems (music condition
 * only), avoiding the backend validate_phase (baseline|post only) and
 * build_effect_history (subject,condition) pairing limits.
 */

export const GEMS9_SCALE_ID = 'gems9_music_v1';

export const GEMS9_MIN_VALUE = 1;
export const GEMS9_MAX_VALUE = 5;

/** Administration instruction (doc §2.5, verbatim). */
export const GEMS9_INSTRUCTION = '刚才的音乐让你感受到下列情绪的程度';

/**
 * Agreement anchors for answer values 1-5. The two endpoints are doc-verbatim
 * (完全不同意 / 完全同意); the middle three interpolate the same agreement
 * pole so the shared five-column anchor row renders one label per value.
 */
export const GEMS9_ANCHOR_LABELS: readonly string[] = [
  '完全不同意',
  '不同意',
  '中立',
  '同意',
  '完全同意',
];

export type Gems9DimensionKey =
  | 'wonder'
  | 'transcendence'
  | 'nostalgia'
  | 'tenderness'
  | 'peacefulness'
  | 'joyful_activation'
  | 'power'
  | 'tension'
  | 'sadness';

export type Gems9Item = {
  /** Raw answer key (doc §3.3 stores answers as {wonder..sadness}). */
  id: Gems9DimensionKey;
  /** English dimension name (doc §2.5). */
  textEn: string;
  /** Chinese dimension name (doc §2.5, verbatim). */
  textZh: string;
};

/** One item per dimension, in doc §2.5 order. */
export const gems9Items: readonly Gems9Item[] = [
  { id: 'wonder', textEn: 'Wonder', textZh: '惊叹' },
  { id: 'transcendence', textEn: 'Transcendence', textZh: '超越' },
  { id: 'nostalgia', textEn: 'Nostalgia', textZh: '怀旧' },
  { id: 'tenderness', textEn: 'Tenderness', textZh: '温柔' },
  { id: 'peacefulness', textEn: 'Peacefulness', textZh: '宁静' },
  { id: 'joyful_activation', textEn: 'Joyful activation', textZh: '欢快' },
  { id: 'power', textEn: 'Power', textZh: '力量' },
  { id: 'tension', textEn: 'Tension', textZh: '紧张' },
  { id: 'sadness', textEn: 'Sadness', textZh: '悲伤' },
];

/**
 * Frozen v1 definition object: everything the battery builder and the dialog
 * need to render and score the GEMS-9 section.
 */
export const gems9MusicV1 = {
  scaleId: GEMS9_SCALE_ID,
  instruction: GEMS9_INSTRUCTION,
  anchorLabels: GEMS9_ANCHOR_LABELS,
  minValue: GEMS9_MIN_VALUE,
  maxValue: GEMS9_MAX_VALUE,
  items: gems9Items,
} as const;

export type Gems9Score = Record<Gems9DimensionKey, number>;

/**
 * Pure GEMS-9 scorer: the nine-dimension mean table. Each dimension carries
 * exactly one item (the GEMS-9 design), so the per-dimension mean equals the
 * single raw 1-5 answer. Throws on a missing or out-of-range answer —
 * callers gate submission on completeness first.
 */
export function scoreGems9(answers: Record<string, number>): Gems9Score {
  const score = {} as Gems9Score;

  for (const item of gems9Items) {
    const value = answers[item.id];
    if (
      typeof value !== 'number'
      || !Number.isInteger(value)
      || value < GEMS9_MIN_VALUE
      || value > GEMS9_MAX_VALUE
    ) {
      throw new Error(`Invalid or missing GEMS-9 answer for ${item.id}.`);
    }
    score[item.id] = value;
  }

  return score;
}
