/**
 * state-PANAS (positive and negative affect) — the affect arm of the pre/post
 * battery. Source: Watson D, Clark LA, Tellegen A (1988). Development and
 * validation of brief measures of positive and negative affect: the PANAS
 * scales. Journal of Personality and Social Psychology 54(6):1063-1070.
 * State instruction measures "right now" (docs/scale-instruments.md §2.3);
 * Chinese renderings are research translations (邱林等 2008 check pending,
 * doc §4).
 */

export const PANAS20_SCALE_ID = 'panas20_state_v1';

/** State administration instruction (doc §2.3, verbatim). */
export const PANAS_STATE_INSTRUCTION = '此刻你的感受有多符合下列词语';

/** Intensity anchors for answer values 1-5 (doc §2.3, verbatim). */
export const PANAS_ANCHOR_LABELS: readonly string[] = [
  '非常轻微或几乎没有',
  '有一点',
  '中等程度',
  '相当多',
  '非常多',
];

export const PANAS_MIN_VALUE = 1;
export const PANAS_MAX_VALUE = 5;

export type PanasSubscale = 'PA' | 'NA';

export type PanasItem = {
  /** Raw answer key (doc §3.3 stores answers as {P1..P20}). */
  id: string;
  /** Original English word (doc §2.3 table). */
  textEn: string;
  /** Chinese rendering (doc §2.3 table, verbatim). */
  textZh: string;
  /** Subscale membership: PA = positive affect, NA = negative affect. */
  subscale: PanasSubscale;
};

/** P1-P20 with the doc §2.3 subscale assignment. */
export const panas20Items: readonly PanasItem[] = [
  { id: 'P1', textEn: 'Interested', textZh: '感兴趣的', subscale: 'PA' },
  { id: 'P2', textEn: 'Distressed', textZh: '心烦的', subscale: 'NA' },
  { id: 'P3', textEn: 'Excited', textZh: '兴奋的', subscale: 'PA' },
  { id: 'P4', textEn: 'Upset', textZh: '心神不安的', subscale: 'NA' },
  { id: 'P5', textEn: 'Strong', textZh: '强有力的', subscale: 'PA' },
  { id: 'P6', textEn: 'Guilty', textZh: '内疚的', subscale: 'NA' },
  { id: 'P7', textEn: 'Scared', textZh: '惊恐的', subscale: 'NA' },
  { id: 'P8', textEn: 'Hostile', textZh: '敌对的', subscale: 'NA' },
  { id: 'P9', textEn: 'Enthusiastic', textZh: '热情的', subscale: 'PA' },
  { id: 'P10', textEn: 'Proud', textZh: '自豪的', subscale: 'PA' },
  { id: 'P11', textEn: 'Irritable', textZh: '易怒的', subscale: 'NA' },
  { id: 'P12', textEn: 'Alert', textZh: '警觉的', subscale: 'PA' },
  { id: 'P13', textEn: 'Ashamed', textZh: '羞愧的', subscale: 'NA' },
  { id: 'P14', textEn: 'Inspired', textZh: '受鼓舞的', subscale: 'PA' },
  { id: 'P15', textEn: 'Nervous', textZh: '紧张的', subscale: 'NA' },
  { id: 'P16', textEn: 'Determined', textZh: '坚定有决心的', subscale: 'PA' },
  { id: 'P17', textEn: 'Attentive', textZh: '专注的', subscale: 'PA' },
  { id: 'P18', textEn: 'Jittery', textZh: '坐立不安的', subscale: 'NA' },
  { id: 'P19', textEn: 'Active', textZh: '活跃的', subscale: 'PA' },
  { id: 'P20', textEn: 'Afraid', textZh: '害怕的', subscale: 'NA' },
];

export const PANAS_PA_ITEM_IDS: readonly string[] = panas20Items
  .filter((item) => item.subscale === 'PA')
  .map((item) => item.id);

export const PANAS_NA_ITEM_IDS: readonly string[] = panas20Items
  .filter((item) => item.subscale === 'NA')
  .map((item) => item.id);

/** Rounds to 4 decimals — the battery's stored precision (doc §3.4). */
export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export type PanasScore = {
  /** Positive-affect mean, range 1-5. */
  paMean: number;
  /** Negative-affect mean, range 1-5. */
  naMean: number;
};

function subscaleMean(answers: Record<string, number>, itemIds: readonly string[]): number {
  let sum = 0;

  for (const id of itemIds) {
    const value = answers[id];
    if (
      typeof value !== 'number'
      || !Number.isInteger(value)
      || value < PANAS_MIN_VALUE
      || value > PANAS_MAX_VALUE
    ) {
      throw new Error(`Invalid or missing PANAS answer for ${id}.`);
    }
    sum += value;
  }

  // Subscale MEAN (doc §2.3 均分制): robust against missing-item drift.
  return round4(sum / itemIds.length);
}

/**
 * Pure PANAS scorer: PA and NA subscale means (1-5, 4-decimal precision).
 * Throws on a missing or out-of-range answer — callers gate submission on
 * completeness first.
 */
export function scorePanas20(answers: Record<string, number>): PanasScore {
  return {
    paMean: subscaleMean(answers, PANAS_PA_ITEM_IDS),
    naMean: subscaleMean(answers, PANAS_NA_ITEM_IDS),
  };
}
