/**
 * STAI-S (state anxiety, Form Y) — the anxiety arm of the pre/post battery.
 * Source: Spielberger CD (1983). State-Trait Anxiety Inventory (Form Y).
 * Consulting Psychologists Press. State-form instruction measures "right
 * now, at this moment" (docs/scale-instruments.md §2.2).
 *
 * Licensing note (doc §2.2): the STAI is commercially licensed by Mind
 * Garden; confirm the lab license before formal use. The Chinese item texts
 * below are research renderings, verbatim from doc §2.2, and must be checked
 * against the official 李文利/钱铭怡 (1995) revision before publication.
 */

export const STAI_S_SCALE_ID = 'stai_s_state_v1';

/** State-form administration instruction (doc §2.2: "此刻"). */
export const STAI_S_STATE_INSTRUCTION = '此时此刻，以下描述与你当前感受的符合程度是？';

/** Intensity anchors for answer values 1-4 (doc §2.2, verbatim). */
export const STAI_S_ANCHOR_LABELS: readonly string[] = [
  '完全没有',
  '有些',
  '中等程度',
  '非常明显',
];

export const STAI_S_MIN_VALUE = 1;
export const STAI_S_MAX_VALUE = 4;

/** Total score range over the 20 scored items (doc §2.2). */
export const STAI_S_TOTAL_MIN = 20;
export const STAI_S_TOTAL_MAX = 80;

export type StaiSItem = {
  /** Raw answer key (doc §3.3 stores answers as {S1..S20}). */
  id: string;
  /** Original English item (doc §2.2 table). */
  textEn: string;
  /** Chinese rendering (doc §2.2 table, verbatim). */
  textZh: string;
  /** True when the item is reverse-scored (1→4 … 4→1). */
  reversed: boolean;
};

/**
 * S1-S20 with the doc §2.2 scoring key: reverse-scored items are
 * 1, 2, 5, 8, 10, 11, 15, 16, 19, 20.
 */
export const staiSItems: readonly StaiSItem[] = [
  { id: 'S1', textEn: 'I feel calm', textZh: '我感到镇静', reversed: true },
  { id: 'S2', textEn: 'I feel secure', textZh: '我感到安全', reversed: true },
  { id: 'S3', textEn: 'I am tense', textZh: '我感到紧张', reversed: false },
  { id: 'S4', textEn: 'I am regretful', textZh: '我感到懊悔', reversed: false },
  { id: 'S5', textEn: 'I feel at ease', textZh: '我感到轻松自在', reversed: true },
  { id: 'S6', textEn: 'I feel upset', textZh: '我感到心烦意乱', reversed: false },
  { id: 'S7', textEn: 'I am presently worrying over possible misfortunes', textZh: '我正为将来可能的不幸而担忧', reversed: false },
  { id: 'S8', textEn: 'I feel rested', textZh: '我感到休息得很好', reversed: true },
  { id: 'S9', textEn: 'I feel anxious', textZh: '我感到焦虑', reversed: false },
  { id: 'S10', textEn: 'I feel comfortable', textZh: '我感到舒适', reversed: true },
  { id: 'S11', textEn: 'I feel self-confident', textZh: '我充满自信', reversed: true },
  { id: 'S12', textEn: 'I feel nervous', textZh: '我感到紧张不安', reversed: false },
  { id: 'S13', textEn: 'I am jittery', textZh: '我感到坐立不安', reversed: false },
  { id: 'S14', textEn: 'I feel indecisive', textZh: '我感到犹豫不决', reversed: false },
  { id: 'S15', textEn: 'I am relaxed', textZh: '我是放松的', reversed: true },
  { id: 'S16', textEn: 'I feel content', textZh: '我感到满足', reversed: true },
  { id: 'S17', textEn: 'I am worried', textZh: '我感到担忧', reversed: false },
  { id: 'S18', textEn: 'I am confused', textZh: '我感到茫然困惑', reversed: false },
  { id: 'S19', textEn: 'I feel steady', textZh: '我感到平稳安定', reversed: true },
  { id: 'S20', textEn: 'I feel pleasant', textZh: '我感到愉快', reversed: true },
];

/** Reverse-scored item ids per the doc §2.2 scoring key. */
export const STAI_S_REVERSED_ITEM_IDS: readonly string[] = staiSItems
  .filter((item) => item.reversed)
  .map((item) => item.id);

/**
 * Scored value of one item: forward items keep the raw 1-4 answer, reversed
 * items flip it (1→4 … 4→1). Throws on an out-of-range answer.
 */
export function staiSItemScore(item: StaiSItem, value: number): number {
  if (
    !Number.isInteger(value)
    || value < STAI_S_MIN_VALUE
    || value > STAI_S_MAX_VALUE
  ) {
    throw new Error(`Invalid STAI-S answer for ${item.id}: ${value}.`);
  }

  return item.reversed
    ? STAI_S_MIN_VALUE + STAI_S_MAX_VALUE - value
    : value;
}

export type StaiSScore = {
  /** Sum over all 20 scored items, range 20-80 (higher = more anxiety). */
  total: number;
};

/**
 * Pure STAI-S scorer. Throws on a missing answer — callers gate submission
 * on completeness first.
 */
export function scoreStaiS(answers: Record<string, number>): StaiSScore {
  let total = 0;

  for (const item of staiSItems) {
    const value = answers[item.id];
    if (typeof value !== 'number') {
      throw new Error(`Missing STAI-S answer for ${item.id}.`);
    }
    total += staiSItemScore(item, value);
  }

  return { total };
}
