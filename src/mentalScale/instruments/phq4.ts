/**
 * PHQ-4 screening instrument (public domain): Kroenke K, Spitzer RL,
 * Williams JBW, Löwe B (2009). An ultra-brief screening scale for anxiety and
 * depression: the PHQ-4. Psychosomatics 50(6):613-621.
 *
 * Spec source: docs/scale-instruments.md §2.1 — item wording, anchors, and
 * subscale mapping are verbatim from that document. The PHQ-4 gates the
 * regulation pages only; its trait-style "past two weeks" window must never
 * feed the pre/post improvement engine (doc §0.1-0.2), so it never enters the
 * wizard's baseline/post pipeline.
 */

export const PHQ4_SCALE_ID = 'phq4_screen_v1';

/** Trait-style recall window stored inside the gate record's raw answers. */
export const PHQ4_TIMEFRAME = 'past_2_weeks';

/** Administration instruction (doc §2.1, verbatim). */
export const PHQ4_INSTRUCTION = '在过去两周里，以下问题困扰你的频繁程度？';

/** Frequency anchors for answer values 0-3 (doc §2.1, verbatim). */
export const PHQ4_ANCHOR_LABELS: readonly string[] = [
  '完全不会',
  '好几天',
  '一半以上的天数',
  '几乎每天',
];

export const PHQ4_MIN_VALUE = 0;
export const PHQ4_MAX_VALUE = 3;

export type Phq4ItemId = 'phq4_1' | 'phq4_2' | 'phq4_3' | 'phq4_4';

export type Phq4Subscale = 'depression' | 'anxiety';

export type Phq4Item = {
  id: Phq4ItemId;
  /** Chinese item text (doc §2.1, verbatim). */
  textZh: string;
  /** Subscale the item belongs to: depression = items 1+2, anxiety = 3+4. */
  subscale: Phq4Subscale;
};

export const phq4Items: readonly Phq4Item[] = [
  { id: 'phq4_1', textZh: '做事时提不起劲或没有兴趣', subscale: 'depression' },
  { id: 'phq4_2', textZh: '感到心情低落、沮丧或绝望', subscale: 'depression' },
  { id: 'phq4_3', textZh: '感觉紧张、焦虑或着急', subscale: 'anxiety' },
  { id: 'phq4_4', textZh: '不能停止或控制担忧', subscale: 'anxiety' },
];

/**
 * Literature cutoff on the total score (doc §2.1): totals at or above this
 * value suggest further evaluation. Surfaced in the UI as a neutral,
 * explicitly non-diagnostic note after completion.
 */
export const PHQ4_TOTAL_CUTOFF = 3;

export const PHQ4_SCREENING_NOTE = {
  threshold: PHQ4_TOTAL_CUTOFF,
  message: '总分≥3：建议进一步评估（仅为筛查提示，不构成诊断结论）。',
} as const;

export type Phq4Score = {
  /** Items 1+2, range 0-6. */
  depression: number;
  /** Items 3+4, range 0-6. */
  anxiety: number;
  /** Total score, range 0-12. */
  total: number;
};

function requireAnswer(answers: Record<string, number>, id: string): number {
  const value = answers[id];
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < PHQ4_MIN_VALUE
    || value > PHQ4_MAX_VALUE
  ) {
    throw new Error(`Invalid or missing PHQ-4 answer for ${id}.`);
  }

  return value;
}

/**
 * Pure PHQ-4 scorer: depression = items 1+2, anxiety = items 3+4, total =
 * their sum (0-12). Throws on a missing or out-of-range answer — callers
 * gate submission on completeness first.
 */
export function scorePhq4(answers: Record<string, number>): Phq4Score {
  const depression = requireAnswer(answers, 'phq4_1') + requireAnswer(answers, 'phq4_2');
  const anxiety = requireAnswer(answers, 'phq4_3') + requireAnswer(answers, 'phq4_4');

  return { depression, anxiety, total: depression + anxiety };
}
