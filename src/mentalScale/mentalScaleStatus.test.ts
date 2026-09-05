import { describe, expect, it } from 'vitest';
import {
  buildBatteryMentalScaleStatus,
  buildMentalScaleStatus,
  defaultMentalScaleStatus,
  measuredDimensionKeys,
  mentalScaleDimensions,
} from './mentalScaleStatus';
import { mentalScaleDefinitions, type MentalScaleAnswers } from './mentalScaleGate';
import { staiPanasBatteryDefinition } from './instruments/battery';

describe('mentalScaleStatus', () => {
  it('starts every radar dimension at the average baseline', () => {
    expect(defaultMentalScaleStatus.dimensions).toEqual(
      mentalScaleDimensions.map((dimension) => ({
        ...dimension,
        value: 50,
      })),
    );
  });

  it('maps completed PHQ-4 answers into dynamic radar dimension values', () => {
    const scale = mentalScaleDefinitions['/video-regulation'];
    const answers: MentalScaleAnswers = {
      phq4_1: 3,
      phq4_2: 1,
      phq4_3: 0,
    };

    const status = buildMentalScaleStatus(scale, answers);

    expect(status.lastScaleTitle).toBe('心理健康筛查（PHQ-4）');
    // Percent-of-max scaling per dimension (answer/3*100): q1=100 + q2=33
    // average to 67 for mood; q3=0 for anxiety.
    expect(status.dimensions.find((dimension) => dimension.key === 'anxiety')?.value).toBe(0);
    expect(status.dimensions.find((dimension) => dimension.key === 'mood')?.value).toBe(67);
    expect(status.dimensions.find((dimension) => dimension.key === 'worry')?.value).toBe(50);
    expect(status.dimensions.find((dimension) => dimension.key === 'energy')?.value).toBe(50);
  });

  it('marks only the dimensions that received at least one answer (R4/F1)', () => {
    const scale = mentalScaleDefinitions['/video-regulation'];
    const answers: MentalScaleAnswers = {
      phq4_1: 3,
      phq4_2: 1,
      phq4_3: 0,
    };

    // worry (item 4) and energy have no answer here, so they stay unmeasured
    // even though buildMentalScaleStatus still reports placeholder values.
    expect(measuredDimensionKeys(scale, answers)).toEqual(['anxiety', 'mood']);
  });

  it('returns an empty marker list when nothing was answered and keeps canonical order', () => {
    const scale = mentalScaleDefinitions['/video-regulation'];

    expect(measuredDimensionKeys(scale, {})).toEqual([]);

    // All four PHQ-4 items answered → mood (items 1+2), anxiety (item 3),
    // worry (item 4) measured, in canonical dimension order.
    const allAnswered: MentalScaleAnswers = {};
    for (const question of scale.questions) {
      allAnswered[question.id] = 2;
    }
    expect(measuredDimensionKeys(scale, allAnswered)).toEqual([
      'anxiety',
      'worry',
      'mood',
    ]);
  });
});

describe('buildBatteryMentalScaleStatus', () => {
  it('maps battery engine scores onto 0-100 severity percent (lower=better inputs)', () => {
    const status = buildBatteryMentalScaleStatus({ anxiety: 50, mood: 3, energy: 1 }, 123);

    // anxiety (50-20)/60 = 50%, mood (3-1)/4 = 50%, energy (1-1)/4 = 0%.
    expect(status.dimensions.find((dimension) => dimension.key === 'anxiety')?.value).toBe(50);
    expect(status.dimensions.find((dimension) => dimension.key === 'mood')?.value).toBe(50);
    expect(status.dimensions.find((dimension) => dimension.key === 'energy')?.value).toBe(0);
    // worry is not measured by the battery and keeps the neutral placeholder.
    expect(status.dimensions.find((dimension) => dimension.key === 'worry')?.value).toBe(50);
    expect(status.lastScaleTitle).toBe(staiPanasBatteryDefinition.title);
    expect(status.updatedAt).toBe(123);
  });

  it('clamps to the range ends: worst battery scores read 100%', () => {
    const status = buildBatteryMentalScaleStatus({ anxiety: 80, mood: 5, energy: 5 });
    expect(status.dimensions.map((dimension) => dimension.value)).toEqual([100, 50, 100, 100]);
  });
});
