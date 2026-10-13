import { describe, expect, it } from 'vitest';
import { formatScoreValue, scoreBarPercent } from './EffectResultCards';

describe('EffectResultCards Score Formatting & Bar Scaling', () => {
  it('formats values <= 10 with 1 decimal place (e.g. PANAS 1.0 - 5.0)', () => {
    expect(formatScoreValue(2.4)).toBe('2.4');
    expect(formatScoreValue(1.8)).toBe('1.8');
    expect(formatScoreValue(2.0)).toBe('2.0');
    expect(formatScoreValue(5)).toBe('5.0');
    expect(formatScoreValue(10)).toBe('10.0');
  });

  it('formats total score values > 10 as clean integers or decimals (e.g. STAI 20 - 80)', () => {
    expect(formatScoreValue(50)).toBe('50');
    expect(formatScoreValue(48)).toBe('48');
    expect(formatScoreValue(55.5)).toBe('55.5');
  });

  it('calculates proportional bar percentage for 1-5 scale scores', () => {
    // 2.5 on 1-5 scale is 50%
    expect(scoreBarPercent(2.5)).toBe(50);
    // 5 on 1-5 scale is 100%
    expect(scoreBarPercent(5)).toBe(100);
    // 1 on 1-5 scale is 20%
    expect(scoreBarPercent(1)).toBe(20);
  });

  it('calculates proportional bar percentage for total scores (0-100)', () => {
    expect(scoreBarPercent(50)).toBe(50);
    expect(scoreBarPercent(80)).toBe(80);
    expect(scoreBarPercent(100)).toBe(100);
  });
});
