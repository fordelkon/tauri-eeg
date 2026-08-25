import { describe, expect, it } from 'vitest';
import type { ParadigmTrialPlanItem } from './types';
import {
  canAdvanceTrialPhase,
  canConfirmQuality,
  canEndSession,
  canEndTrial,
  canStartNextTrial,
  canSubmitSelfReport,
  initialParadigmSessionState,
  isLastTrial,
  paradigmSessionReducer,
} from './paradigmSessionState';

const queue: ParadigmTrialPlanItem[] = [
  {
    trialIndex: 0,
    emotion: 'depression',
    triggerClass: 1,
    videoId: 'dep-01',
    videoPath: 'D:\\Paradigm\\Depression\\dep-01.mp4',
  },
  {
    trialIndex: 1,
    emotion: 'calm',
    triggerClass: 3,
    videoId: 'calm-01',
    videoPath: 'D:\\Paradigm\\Calm\\calm-01.mp4',
  },
  {
    trialIndex: 2,
    emotion: 'happy',
    triggerClass: 4,
    videoId: 'hap-01',
    videoPath: 'D:\\Paradigm\\Happy\\hap-01.mp4',
  },
];

function startRunningSession() {
  return paradigmSessionReducer(
    paradigmSessionReducer(initialParadigmSessionState, { type: 'enter_setup' }),
    { type: 'session_started', queue },
  );
}

describe('paradigmSessionReducer', () => {
  it('walks one trial from baseline through quality check', () => {
    let state = startRunningSession();

    expect(state).toMatchObject({ phase: 'running', trialPhase: 'interTrial', currentTrialIndex: -1 });
    expect(canStartNextTrial(state)).toBe(true);

    state = paradigmSessionReducer(state, { type: 'trial_started', trialIndex: 0 });
    expect(state).toMatchObject({
      phase: 'running',
      trialPhase: 'baseline',
      currentTrialIndex: 0,
    });
    expect(canAdvanceTrialPhase(state)).toBe(true);

    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    expect(state.trialPhase).toBe('hint');

    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    expect(state.trialPhase).toBe('video');

    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    expect(state.trialPhase).toBe('postRest');
    expect(canAdvanceTrialPhase(state)).toBe(false);
    expect(canEndTrial(state)).toBe(true);

    state = paradigmSessionReducer(state, { type: 'trial_ended' });
    expect(state.trialPhase).toBe('selfReport');
    expect(canSubmitSelfReport(state)).toBe(true);

    state = paradigmSessionReducer(state, {
      type: 'self_report_submitted',
      selfReport: { valence: 3, arousal: 3 },
      suggestedQuality: 'accepted',
    });
    expect(state).toMatchObject({
      trialPhase: 'qualityCheck',
      suggestedQuality: 'accepted',
    });
    expect(canConfirmQuality(state)).toBe(true);
    expect(state.selfReport).toEqual({ valence: 3, arousal: 3 });

    state = paradigmSessionReducer(state, { type: 'trial_finalized' });
    expect(state).toMatchObject({ phase: 'running', trialPhase: 'interTrial' });
    expect(isLastTrial(state)).toBe(false);
  });

  it('moves to the next trial and finishes after the last one', () => {
    let state = startRunningSession();

    state = paradigmSessionReducer(state, { type: 'trial_started', trialIndex: 0 });
    // baseline -> hint -> video -> postRest, then gate into self report.
    state = paradigmSessionReducer(
      paradigmSessionReducer(
        paradigmSessionReducer(state, { type: 'advance_trial_phase' }),
        { type: 'advance_trial_phase' },
      ),
      { type: 'advance_trial_phase' },
    );
    state = paradigmSessionReducer(state, { type: 'trial_ended' });
    state = paradigmSessionReducer(state, {
      type: 'self_report_submitted',
      selfReport: { valence: 6, arousal: 2 },
      suggestedQuality: 'accepted',
    });
    state = paradigmSessionReducer(state, { type: 'trial_finalized' });
    expect(state.trialPhase).toBe('interTrial');
    expect(canStartNextTrial(state)).toBe(true);

    state = paradigmSessionReducer(state, { type: 'trial_started', trialIndex: 1 });
    expect(state.currentTrialIndex).toBe(1);

    state = paradigmSessionReducer(state, { type: 'trial_started', trialIndex: 2 });
    // Out-of-order starts are rejected; trial 1 is still active.
    expect(state.currentTrialIndex).toBe(1);

    // End trial 1 and start the final trial.
    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    state = paradigmSessionReducer(state, { type: 'trial_ended' });
    state = paradigmSessionReducer(state, {
      type: 'self_report_submitted',
      selfReport: { valence: 3, arousal: 7 },
      suggestedQuality: 'accepted',
    });
    state = paradigmSessionReducer(state, { type: 'trial_finalized' });
    state = paradigmSessionReducer(state, { type: 'trial_started', trialIndex: 2 });
    expect(isLastTrial(state)).toBe(true);
    expect(canStartNextTrial(state)).toBe(false);

    // Final trial: baseline -> hint -> video -> postRest -> self report ->
    // quality check -> finished.
    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    state = paradigmSessionReducer(state, { type: 'trial_ended' });
    state = paradigmSessionReducer(state, {
      type: 'self_report_submitted',
      selfReport: { valence: 7, arousal: 6 },
      suggestedQuality: 'accepted',
    });
    state = paradigmSessionReducer(state, { type: 'trial_finalized' });
    expect(state).toMatchObject({ phase: 'finished', trialPhase: 'interTrial' });
  });

  it('skips a failed trial to interTrial, or finishes on the last one', () => {
    let state = startRunningSession();

    // Skipping is meaningless without an active trial stage.
    expect(paradigmSessionReducer(state, { type: 'trial_skipped' })).toBe(state);

    state = paradigmSessionReducer(state, { type: 'trial_started', trialIndex: 0 });
    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    expect(state.trialPhase).toBe('video');

    state = paradigmSessionReducer(state, { type: 'command_failed', message: 'skip failed' });
    state = paradigmSessionReducer(state, { type: 'trial_skipped' });
    expect(state).toMatchObject({
      phase: 'running',
      trialPhase: 'interTrial',
      errorMessage: null,
      selfReport: null,
      suggestedQuality: null,
    });
    expect(canStartNextTrial(state)).toBe(true);

    // Jump straight to the last trial and skip there: the session must finish
    // so the runner stops the recording and loads the summary.
    state = paradigmSessionReducer(state, { type: 'trial_started', trialIndex: 1 });
    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    state = paradigmSessionReducer(state, { type: 'trial_skipped' });

    const lastState = paradigmSessionReducer(state, { type: 'trial_started', trialIndex: 2 });
    expect(isLastTrial(lastState)).toBe(true);
    const skippedFinal = paradigmSessionReducer(lastState, { type: 'trial_skipped' });
    expect(skippedFinal).toMatchObject({ phase: 'finished', trialPhase: 'interTrial' });
  });

  it('rejects transitions in the wrong phase', () => {
    const state = startRunningSession();

    // No active trial yet: countdown/self-report/finalize all no-ops.
    expect(paradigmSessionReducer(state, { type: 'advance_trial_phase' })).toBe(state);
    expect(paradigmSessionReducer(state, { type: 'trial_ended' })).toBe(state);
    expect(paradigmSessionReducer(state, {
      type: 'self_report_submitted',
      selfReport: { valence: 5, arousal: 5 },
      suggestedQuality: 'uncertain',
    })).toBe(state);
    expect(paradigmSessionReducer(state, { type: 'trial_finalized' })).toBe(state);

    // setup -> running only via session_started; idle cannot jump ahead.
    expect(paradigmSessionReducer(initialParadigmSessionState, {
      type: 'session_started',
      queue,
    })).toBe(initialParadigmSessionState);
    expect(paradigmSessionReducer(initialParadigmSessionState, {
      type: 'trial_started',
      trialIndex: 0,
    })).toBe(initialParadigmSessionState);
  });

  it('records recoverable command errors without leaving the stage', () => {
    let state = startRunningSession();

    state = paradigmSessionReducer(state, { type: 'trial_started', trialIndex: 0 });
    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    state = paradigmSessionReducer(state, { type: 'advance_trial_phase' });
    state = paradigmSessionReducer(state, {
      type: 'command_failed',
      message: 'end_eeg_trial failed: no active trial',
    });

    expect(state).toMatchObject({
      phase: 'running',
      trialPhase: 'postRest',
      errorMessage: 'end_eeg_trial failed: no active trial',
    });
    expect(canEndTrial(state)).toBe(true);

    state = paradigmSessionReducer(state, { type: 'reset_error' });
    expect(state.errorMessage).toBeNull();
  });

  it('escalates to the error phase and supports returning to setup', () => {
    let state = startRunningSession();

    state = paradigmSessionReducer(state, {
      type: 'session_failed',
      message: 'Recording backend unavailable.',
    });
    expect(state).toMatchObject({
      phase: 'error',
      errorMessage: 'Recording backend unavailable.',
    });
    expect(canEndSession(state)).toBe(true);

    state = paradigmSessionReducer(state, { type: 'end_session' });
    expect(state).toMatchObject({
      phase: 'setup',
      trialPhase: 'interTrial',
      currentTrialIndex: -1,
      queue: [],
      errorMessage: null,
    });

    // Early end from a running session follows the same path.
    const running = startRunningSession();
    const ended = paradigmSessionReducer(running, { type: 'end_session' });
    expect(ended).toMatchObject({ phase: 'setup', currentTrialIndex: -1 });
    expect(canEndSession(initialParadigmSessionState)).toBe(false);
  });
});
