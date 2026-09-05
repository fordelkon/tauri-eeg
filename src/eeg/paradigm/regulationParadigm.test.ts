import { describe, expect, it } from 'vitest';
import {
  canAdvanceTrialPhase,
  canEndTrial,
  initialParadigmSessionState,
  paradigmSessionReducer,
} from './paradigmSessionState';
import {
  FEEDBACK_DISPLAY_MS,
  REGULATION_CUE_MS,
  REGULATION_WINDOW_MS,
  getTimedPhaseDurationMs,
} from './paradigmTimeline';
import {
  simulateRegulationFeedback,
  summarizeRegulationFeedback,
} from './regulationFeedbackSim';
import { PARADIGM_BLOCKS_BY_KIND } from './types';

const QUEUE = [
  { trialIndex: 0, emotion: 'anxiety' as const, triggerClass: 2 as const, videoId: 'a0', videoPath: 'C:/v/a0.mp4' },
  { trialIndex: 1, emotion: 'anxiety' as const, triggerClass: 2 as const, videoId: 'a1', videoPath: 'C:/v/a1.mp4' },
];

function startRegulationSession(queue = QUEUE) {
  return paradigmSessionReducer(
    paradigmSessionReducer(initialParadigmSessionState, { type: 'enter_setup' }),
    { type: 'session_started', queue, sessionKind: 'regulation_feedback' },
  );
}

function advanceThrough(state: ReturnType<typeof startRegulationSession>, count: number) {
  let current = state;
  for (let index = 0; index < count; index += 1) {
    current = paradigmSessionReducer(current, { type: 'advance_trial_phase' });
  }
  return current;
}

describe('regulation session state machine', () => {
  it('stores the session kind and keeps the induction default for legacy dispatches', () => {
    const regulation = startRegulationSession();
    expect(regulation.sessionKind).toBe('regulation_feedback');

    const induction = paradigmSessionReducer(
      paradigmSessionReducer(initialParadigmSessionState, { type: 'enter_setup' }),
      { type: 'session_started', queue: QUEUE },
    );
    expect(induction.sessionKind).toBe('held_out_generation');
  });

  it('follows the regulation phase sequence video -> cue -> window -> feedback', () => {
    let state = paradigmSessionReducer(startRegulationSession(), { type: 'trial_started', trialIndex: 0 });
    expect(state.trialPhase).toBe('baseline');

    state = advanceThrough(state, 2); // baseline -> hint -> video
    expect(state.trialPhase).toBe('video');

    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' }); // video ends
    expect(state.trialPhase).toBe('regulationCue');

    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' }); // cue ends
    expect(state.trialPhase).toBe('regulationWindow');

    // The reappraisal window must not end the trial directly.
    expect(canEndTrial(state)).toBe(false);

    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' }); // window ends
    expect(state.trialPhase).toBe('feedback');
    expect(canAdvanceTrialPhase(state)).toBe(false);
    expect(canEndTrial(state)).toBe(true);

    state = paradigmSessionReducer(state, { type: 'trial_ended' });
    expect(state.trialPhase).toBe('selfReport');
  });

  it('keeps induction trials on the baseline -> hint -> video -> postRest flow', () => {
    const started = paradigmSessionReducer(startRegulationSession(), { type: 'trial_started', trialIndex: 0 });
    const induction = { ...started, sessionKind: 'held_out_generation' as const };

    const advanced = advanceThrough(induction, 3);
    expect(advanced.trialPhase).toBe('postRest');
    expect(canEndTrial(advanced)).toBe(true);
  });

  it('allows skipping from the regulation stages', () => {
    let state = paradigmSessionReducer(startRegulationSession(), { type: 'trial_started', trialIndex: 0 });
    state = advanceThrough(state, 4); // -> regulationWindow

    const skipped = paradigmSessionReducer(state, { type: 'trial_skipped' });
    expect(skipped.trialPhase).toBe('interTrial');
  });
});

describe('regulation timeline durations', () => {
  it('gives the regulation stages their protocol durations', () => {
    expect(getTimedPhaseDurationMs('regulationCue')).toBe(REGULATION_CUE_MS);
    expect(getTimedPhaseDurationMs('regulationWindow')).toBe(REGULATION_WINDOW_MS);
    expect(getTimedPhaseDurationMs('feedback')).toBe(FEEDBACK_DISPLAY_MS);
  });

  it('schedules the three negative induction classes for regulation runs', () => {
    expect(PARADIGM_BLOCKS_BY_KIND.regulation_feedback).toEqual(['anxiety', 'depression', 'fear']);
  });
});

describe('simulated regulation feedback', () => {
  it('produces a bounded trajectory with consistent delta', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const sample = simulateRegulationFeedback('anxiety', random);
    expect(sample.trajectory).toHaveLength(12);
    for (const value of [sample.baselineScore, ...sample.trajectory, sample.regulationScore]) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
    }
    expect(sample.deltaScore).toBeCloseTo(sample.regulationScore - sample.baselineScore, 10);
  });

  it('drifts upward on average (reappraisal succeeds more often than not)', () => {
    let seed = 1;
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const improved = Array.from({ length: 40 }, () => simulateRegulationFeedback('fear', random))
      .filter((sample) => sample.deltaScore > 0)
      .length;
    expect(improved).toBeGreaterThan(30);
  });

  it('summarizes per-session statistics including the learning index', () => {
    const summary = summarizeRegulationFeedback([
      { emotion: 'anxiety', baselineScore: 0.3, regulationScore: 0.4, deltaScore: 0.1 },
      { emotion: 'fear', baselineScore: 0.3, regulationScore: 0.25, deltaScore: -0.05 },
    ]);

    expect(summary.totalTrials).toBe(2);
    expect(summary.baselineMean).toBeCloseTo(0.3, 10);
    expect(summary.regulationMean).toBeCloseTo(0.325, 10);
    expect(summary.deltaMean).toBeCloseTo(0.025, 10);
    expect(summary.improvedTrials).toBe(1);
  });

  it('handles an empty stat list', () => {
    const summary = summarizeRegulationFeedback([]);
    expect(summary.totalTrials).toBe(0);
    expect(summary.deltaMean).toBe(0);
  });
});
