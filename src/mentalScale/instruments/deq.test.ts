import { describe, expect, it } from 'vitest';
import {
  buildDeqMeasurement,
  deqItems,
  hasCompleteDeqRatings,
  scoreDeq,
  type DeqAnswers,
} from './deq';

const ratings: DeqAnswers['deq'] = {
  anxiety: 2,
  dread: 1,
  nervous: 3,
  worry: 4,
  sad: 7,
  empty: 7,
  grief: 7,
  lonely: 7,
  fear: 4,
  panic: 7,
  scared: 5,
  terror: 7,
};

describe('DEQ 中文状态评分', () => {
  it('retains each original rating and independent four-item means', () => {
    expect(deqItems).toHaveLength(12);
    expect(new Set(deqItems.map(({ id }) => id)).size).toBe(12);
    expect(hasCompleteDeqRatings(ratings)).toBe(true);
    expect(buildDeqMeasurement({ deq: ratings })).toEqual({
      scaleId: 'deq_zh_state_12_v1',
      dimensionScores: { anxiety: 2.5, sadness: 7, fear: 5.75 },
      rawAnswers: { deq: ratings, timeframe: 'now' },
      measuredDimensions: ['anxiety', 'sadness', 'fear'],
    });
  });

  it.each([undefined, 0, 8, 3.5, NaN])('rejects an incomplete or invalid row (%s)', (panic) => {
    const partial = { ...ratings, panic };
    expect(hasCompleteDeqRatings(partial)).toBe(false);
    expect(() => scoreDeq(partial)).toThrow('惊慌');
  });
});
