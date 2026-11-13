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

  it('maps momentary check-in answers into dynamic radar dimension values', () => {
    const scale = mentalScaleDefinitions['/video-regulation'];
    const answers: MentalScaleAnswers = {
      unpleasant_now: 2,
      tension_now: 0,
    };

    const status = buildMentalScaleStatus(scale, answers);

    expect(status.lastScaleTitle).toBe('此刻感受');
    expect(status.dimensions.find((dimension) => dimension.key === 'anxiety')?.value).toBe(0);
    expect(status.dimensions.find((dimension) => dimension.key === 'mood')?.value).toBe(67);
    expect(status.dimensions.find((dimension) => dimension.key === 'worry')?.value).toBe(50);
    expect(status.dimensions.find((dimension) => dimension.key === 'energy')?.value).toBe(50);
  });

  it('marks only the dimensions that received at least one answer (R4/F1)', () => {
    const scale = mentalScaleDefinitions['/video-regulation'];
    const answers: MentalScaleAnswers = {
      unpleasant_now: 2,
      tension_now: 0,
    };

    // worry (item 4) and energy have no answer here, so they stay unmeasured
    // even though buildMentalScaleStatus still reports placeholder values.
    expect(measuredDimensionKeys(scale, answers)).toEqual(['anxiety', 'mood']);
  });

  it('returns an empty marker list when nothing was answered and keeps canonical order', () => {
    const scale = mentalScaleDefinitions['/video-regulation'];

    expect(measuredDimensionKeys(scale, {})).toEqual([]);

    const allAnswered: MentalScaleAnswers = {};
    for (const question of scale.questions) {
      allAnswered[question.id] = 2;
    }
    expect(measuredDimensionKeys(scale, allAnswered)).toEqual(['anxiety', 'mood']);
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
