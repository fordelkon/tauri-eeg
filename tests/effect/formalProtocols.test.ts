import { describe, expect, it } from 'vitest';
import { buildPhaseMeasurement } from '../../src/mentalScale/instruments/phaseMeasurement';
import {
  createEffectEvaluationFlowState,
  parseFlowState,
} from '../../src/pages/home/effectEvaluationFlow';

describe('effect measurement protocols', () => {
  const ratings = { valence: 1, arousal: 9, dominance: 3 };
  it('preserves all three original 1–9 ratings without reversing arousal', () => {
    expect(buildPhaseMeasurement('brief', ratings)).toEqual({
      scaleId: 'momentary_vad_3_v1',
      dimensionScores: ratings,
      rawAnswers: { ...ratings, timeframe: 'now' },
      measuredDimensions: ['valence', 'arousal', 'dominance'],
    });
    expect(() => buildPhaseMeasurement('brief', { ...ratings, arousal: 0 })).toThrow();
    expect(() => buildPhaseMeasurement('full', ratings)).toThrow();
    expect(() => buildPhaseMeasurement('brief', { stai: {}, panas: {} })).toThrow();
  });
  it('starts brief, preserves explicit protocols, and resumes older sessions with their original measurement', () => {
    const current = createEffectEvaluationFlowState();
    expect(current.protocol).toBe('brief');
    const legacy = { ...current, version: 4, protocol: undefined };
    expect(parseFlowState(JSON.stringify(legacy))?.protocol).toBe('brief');
    expect(parseFlowState(JSON.stringify({ ...legacy, step: 3 }))?.protocol).toBe('full');
    expect(parseFlowState(JSON.stringify({ ...current, protocol: 'full' }))?.protocol).toBe('full');
    expect(parseFlowState(JSON.stringify({ ...current, protocol: 'invalid' }))).toBeNull();
  });
});
