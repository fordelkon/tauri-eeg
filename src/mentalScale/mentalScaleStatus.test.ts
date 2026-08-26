import { describe, expect, it } from 'vitest';
import {
  buildMentalScaleStatus,
  defaultMentalScaleStatus,
  measuredDimensionKeys,
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

    expect(status.lastScaleTitle).toBe('视频调控量表');
    expect(status.dimensions.find((dimension) => dimension.key === 'anxiety')?.value).toBe(100);
    expect(status.dimensions.find((dimension) => dimension.key === 'worry')?.value).toBe(33);
    expect(status.dimensions.find((dimension) => dimension.key === 'mood')?.value).toBe(0);
    expect(status.dimensions.find((dimension) => dimension.key === 'energy')?.value).toBe(50);
  });

  it('marks only the dimensions that received at least one answer (R4/F1)', () => {
    const scale = mentalScaleDefinitions['/video-regulation'];
    const answers: MentalScaleAnswers = {
      'video-anxiety-tense': 3,
      'video-anxiety-worry': 1,
      'video-depression-interest': 0,
    };

    // energy has no question in this scale, so it stays unmeasured even
    // though buildMentalScaleStatus still reports a placeholder value for it.
    expect(measuredDimensionKeys(scale, answers)).toEqual(['anxiety', 'worry', 'mood']);
  });

  it('returns an empty marker list when nothing was answered and keeps canonical order', () => {
    const scale = mentalScaleDefinitions['/video-regulation'];

    expect(measuredDimensionKeys(scale, {})).toEqual([]);

    // The music scale lists its questions mood → energy → anxiety; the
    // markers still come back in the canonical dimension order.
    const musicScale = mentalScaleDefinitions['/music-regulation'];
    const allAnswered: MentalScaleAnswers = {};
    for (const question of musicScale.questions) {
      allAnswered[question.id] = 2;
    }
    expect(measuredDimensionKeys(musicScale, allAnswered)).toEqual([
      'anxiety',
      'mood',
      'energy',
    ]);
  });
});
