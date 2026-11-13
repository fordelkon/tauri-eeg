import { describe, expect, it } from 'vitest';
import {
  getMentalScaleForPath,
  isMentalScaleComplete,
  mentalScaleAnswerOptions,
  mentalScaleDefinitions,
} from './mentalScaleGate';
describe('momentary check-in', () => {
  it('uses the same two current-state questions for all methods', () => {
    for (const scale of Object.values(mentalScaleDefinitions)) {
      expect(getMentalScaleForPath(scale.path)?.scaleId).toBe('momentary_checkin_2_v1');
      expect(scale.questions.map((item) => item.id)).toEqual(['tension_now', 'unpleasant_now']);
      expect(scale.screening).toBeUndefined();
      expect(isMentalScaleComplete(scale, { tension_now: 0 })).toBe(false);
      expect(isMentalScaleComplete(scale, { tension_now: 0, unpleasant_now: 3 })).toBe(true);
    }
    expect(mentalScaleAnswerOptions.map((option) => option.value)).toEqual([0, 1, 2, 3]);
    expect(getMentalScaleForPath('/home')).toBeNull();
  });
});
