/**
 * Three complete subscales of the Discrete Emotions Questionnaire.
 * Harmon-Jones, Bastian & Harmon-Jones (2016), Appendix S1, CC BY.
 * https://doi.org/10.1371/journal.pone.0159915.s001
 * The simplified Chinese labels and present-moment instruction are a local
 * research adaptation. The item order follows the appendix's rows.
 */
export const DEQ_SCALE_ID = 'deq_zh_state_12_v1';
export const deqDimensionKeys = ['anxiety', 'sadness', 'fear'] as const;
export type DeqDimension = (typeof deqDimensionKeys)[number];

export const deqItems = [
  { id: 'scared', label: '害怕', dimension: 'fear' },
  { id: 'dread', label: '对将要发生的事感到畏惧', dimension: 'anxiety' },
  { id: 'sad', label: '悲伤', dimension: 'sadness' },
  { id: 'empty', label: '心里空落落的', dimension: 'sadness' },
  { id: 'panic', label: '惊慌', dimension: 'fear' },
  { id: 'terror', label: '惊恐', dimension: 'fear' },
  { id: 'grief', label: '悲痛', dimension: 'sadness' },
  { id: 'fear', label: '恐惧', dimension: 'fear' },
  { id: 'anxiety', label: '焦虑', dimension: 'anxiety' },
  { id: 'worry', label: '担忧', dimension: 'anxiety' },
  { id: 'nervous', label: '紧张', dimension: 'anxiety' },
  { id: 'lonely', label: '孤独', dimension: 'sadness' },
] as const satisfies ReadonlyArray<{ id: string; label: string; dimension: DeqDimension }>;

export const deqAnchors = [
  '完全没有',
  '轻微',
  '有一些',
  '中等',
  '较强',
  '很强',
  '极其强烈',
] as const;
export type DeqItemId = (typeof deqItems)[number]['id'];
export type DeqAnswers = { deq: Record<DeqItemId, number> };
export type DeqRatings = Partial<DeqAnswers['deq']>;

export function isDeqRating(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7;
}

export function hasCompleteDeqRatings(ratings: DeqRatings): ratings is DeqAnswers['deq'] {
  return deqItems.every(({ id }) => isDeqRating(ratings[id]));
}

/** Four equally weighted items per subscale, all in the same direction. */
export function scoreDeq(ratings: DeqRatings): Record<DeqDimension, number> {
  const scores = { anxiety: 0, sadness: 0, fear: 0 };
  for (const { id, label, dimension } of deqItems) {
    const value = ratings[id];
    if (!isDeqRating(value)) throw new Error(`「${label}」需要选择 1–7 的整数。`);
    scores[dimension] += value / 4;
  }
  return scores;
}

export function buildDeqMeasurement(answers: DeqAnswers) {
  return {
    scaleId: DEQ_SCALE_ID,
    dimensionScores: scoreDeq(answers.deq),
    rawAnswers: { deq: { ...answers.deq }, timeframe: 'now' },
    measuredDimensions: [...deqDimensionKeys],
  };
}
