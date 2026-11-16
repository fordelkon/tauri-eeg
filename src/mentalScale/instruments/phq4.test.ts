import { describe, expect, it } from 'vitest';
import { PHQ4_ANCHOR_LABELS, PHQ4_SCALE_ID, PHQ4_TIMEFRAME, phq4Items, scorePhq4 } from './phq4';

describe('PHQ-4 scoring (doc §2.1)', () => {
  it('uses the frozen screening scale_id and trait timeframe', () => {
    expect(PHQ4_SCALE_ID).toBe('phq4_screen_v1');
    expect(PHQ4_TIMEFRAME).toBe('past_2_weeks');
  });

  it('registers the four items verbatim in doc order', () => {
    expect(phq4Items.map((item) => item.textZh)).toEqual([
      '做事时提不起劲或没有兴趣',
      '感到心情低落、沮丧或绝望',
      '感觉紧张、焦虑或着急',
      '不能停止或控制担忧',
    ]);
    expect([...PHQ4_ANCHOR_LABELS]).toEqual(['完全不会', '好几天', '一半以上的天数', '几乎每天']);
  });

  it('scores depression=items 1+2 and anxiety=items 3+4', () => {
    expect(scorePhq4({ phq4_1: 0, phq4_2: 1, phq4_3: 2, phq4_4: 3 })).toEqual({
      depression: 1,
      anxiety: 5,
      total: 6,
    });
  });

  it('ranges 0-12: all-zero and all-max totals', () => {
    const allZero = { phq4_1: 0, phq4_2: 0, phq4_3: 0, phq4_4: 0 };
    const allMax = { phq4_1: 3, phq4_2: 3, phq4_3: 3, phq4_4: 3 };
    expect(scorePhq4(allZero)).toEqual({ depression: 0, anxiety: 0, total: 0 });
    expect(scorePhq4(allMax)).toEqual({ depression: 6, anxiety: 6, total: 12 });
  });

  it('throws on missing or out-of-range answers', () => {
    expect(() => scorePhq4({ phq4_1: 1, phq4_2: 1, phq4_3: 1 })).toThrow(/phq4_4/);
    expect(() => scorePhq4({ phq4_1: 4, phq4_2: 1, phq4_3: 1, phq4_4: 1 })).toThrow(/phq4_1/);
  });
});
