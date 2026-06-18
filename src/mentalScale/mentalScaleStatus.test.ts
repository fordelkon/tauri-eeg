import { describe, expect, it } from 'vitest';
import {
  buildMentalScaleStatus,
  defaultMentalScaleStatus,
  mentalScaleDimensions,
} from './mentalScaleStatus';
import { mentalScaleDefinitions, type MentalScaleAnswers } from './mentalScaleGate';

describe('mentalScaleStatus', () => {
  it('starts every radar dimension at the average baseline', () => {
    expect(defaultMentalScaleStatus.dimensions).toEqual(
      mentalScaleDimensions.map((dimension) => ({
        ...dimension,
        value: 50,
      })),
    );
  });

  it('maps completed scale answers into dynamic radar dimension values', () => {
    const scale = mentalScaleDefinitions['/video-regulation'];
    const answers: MentalScaleAnswers = {
      'video-anxiety-tense': 3,
      'video-anxiety-worry': 1,
      'video-depression-interest': 0,
    };

    const status = buildMentalScaleStatus(scale, answers);

    expect(status.lastScaleTitle).toBe('Video Regulation Scale');
    expect(status.dimensions.find((dimension) => dimension.key === 'anxiety')?.value).toBe(100);
    expect(status.dimensions.find((dimension) => dimension.key === 'worry')?.value).toBe(33);
    expect(status.dimensions.find((dimension) => dimension.key === 'mood')?.value).toBe(0);
    expect(status.dimensions.find((dimension) => dimension.key === 'energy')?.value).toBe(50);
  });
});
