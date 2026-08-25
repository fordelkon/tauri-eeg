import type {
  ParadigmTrialPlanItem,
  SelfReport,
  TrialQuality,
} from './types';

export type ParadigmSessionPhase = 'idle' | 'setup' | 'running' | 'finished' | 'error';

/**
 * Per-trial stage. 'interTrial' sits between finalize and the next
 * begin_eeg_trial (also used before the first trial and after the last one).
 */
export type ParadigmTrialPhaseState =
  | 'baseline'
  | 'hint'
  | 'video'
  | 'postRest'
  | 'selfReport'
  | 'qualityCheck'
  | 'interTrial';

export type ParadigmSessionState = {
  phase: ParadigmSessionPhase;
  trialPhase: ParadigmTrialPhaseState;
  queue: ParadigmTrialPlanItem[];
  /** Index into the queue of the active trial; -1 before the first trial. */
  currentTrialIndex: number;
  selfReport: SelfReport | null;
  suggestedQuality: TrialQuality | null;
  artifactFlags: string[];
  operatorNotes: string;
  errorMessage: string | null;
  sessionId: string | null;
};

export type ParadigmSessionAction =
  | { type: 'enter_setup' }
  | { type: 'session_started'; queue: ParadigmTrialPlanItem[] }
  | { type: 'session_id_resolved'; sessionId: string }
  | { type: 'trial_started'; trialIndex: number }
  | { type: 'advance_trial_phase' }
  | { type: 'trial_ended' }
  | { type: 'self_report_submitted'; selfReport: SelfReport; suggestedQuality: TrialQuality }
  | { type: 'trial_skipped' }
  | { type: 'artifact_flags_changed'; flags: string[] }
  | { type: 'operator_notes_changed'; notes: string }
  | { type: 'trial_finalized' }
  | { type: 'end_session' }
  | { type: 'command_failed'; message: string }
  | { type: 'session_failed'; message: string }
  | { type: 'reset_error' };

export const initialParadigmSessionState: ParadigmSessionState = {
  phase: 'idle',
  trialPhase: 'interTrial',
  queue: [],
  currentTrialIndex: -1,
  selfReport: null,
  suggestedQuality: null,
  artifactFlags: [],
  operatorNotes: '',
  errorMessage: null,
  sessionId: null,
};

/** Phases whose only legal driver is the fixed countdown (no IPC gate). */
const COUNTDOWN_ADVANCE_FROM: readonly ParadigmTrialPhaseState[] = [
  'baseline',
  'hint',
  'video',
];

const NEXT_COUNTDOWN_PHASE: Record<string, ParadigmTrialPhaseState> = {
  baseline: 'hint',
  hint: 'video',
  video: 'postRest',
};

/** Stages a failed trial can be skipped from: everything before finalize. */
const SKIPPABLE_TRIAL_PHASES: readonly ParadigmTrialPhaseState[] = [
  'baseline',
  'hint',
  'video',
  'postRest',
  'selfReport',
];

function trialAtIndex(queue: ParadigmTrialPlanItem[], trialIndex: number) {
  const item = queue[trialIndex];
  return item && item.trialIndex === trialIndex ? item : null;
}

export function canEnterSetup(state: ParadigmSessionState) {
  return state.phase === 'idle';
}

export function canAdvanceTrialPhase(state: ParadigmSessionState) {
  return (
    state.phase === 'running' &&
    COUNTDOWN_ADVANCE_FROM.includes(state.trialPhase)
  );
}

export function canEndTrial(state: ParadigmSessionState) {
  return state.phase === 'running' && state.trialPhase === 'postRest';
}

export function canSubmitSelfReport(state: ParadigmSessionState) {
  return state.phase === 'running' && state.trialPhase === 'selfReport';
}

export function canConfirmQuality(state: ParadigmSessionState) {
  return state.phase === 'running' && state.trialPhase === 'qualityCheck';
}

export function nextTrialIndex(state: ParadigmSessionState) {
  const candidate = state.currentTrialIndex + 1;
  return trialAtIndex(state.queue, candidate) ? candidate : null;
}

export function canStartNextTrial(state: ParadigmSessionState) {
  return (
    state.phase === 'running' &&
    state.trialPhase === 'interTrial' &&
    nextTrialIndex(state) !== null
  );
}

export function isLastTrial(state: ParadigmSessionState) {
  return (
    state.queue.length > 0 &&
    state.currentTrialIndex === state.queue.length - 1
  );
}

export function canEndSession(state: ParadigmSessionState) {
  return (
    state.phase === 'running' ||
    state.phase === 'finished' ||
    state.phase === 'error'
  );
}

function clearTrialReview(state: ParadigmSessionState): ParadigmSessionState {
  return {
    ...state,
    selfReport: null,
    suggestedQuality: null,
    artifactFlags: [],
    operatorNotes: '',
  };
}

export function paradigmSessionReducer(
  state: ParadigmSessionState,
  action: ParadigmSessionAction,
): ParadigmSessionState {
  switch (action.type) {
    case 'enter_setup':
      if (!canEnterSetup(state)) {
        return state;
      }

      return { ...state, phase: 'setup', errorMessage: null };

    case 'session_started':
      if (state.phase !== 'setup' || action.queue.length === 0) {
        return state;
      }

      return {
        ...clearTrialReview(state),
        phase: 'running',
        trialPhase: 'interTrial',
        queue: action.queue,
        currentTrialIndex: -1,
        sessionId: null,
        errorMessage: null,
      };

    case 'session_id_resolved':
      if (state.phase !== 'running' || state.sessionId !== null) {
        return state;
      }

      return { ...state, sessionId: action.sessionId };

    case 'trial_started':
      if (state.phase !== 'running' || state.trialPhase !== 'interTrial') {
        return state;
      }
      if (
        action.trialIndex !== state.currentTrialIndex + 1 ||
        !trialAtIndex(state.queue, action.trialIndex)
      ) {
        return state;
      }

      return {
        ...clearTrialReview(state),
        trialPhase: 'baseline',
        currentTrialIndex: action.trialIndex,
        errorMessage: null,
      };

    case 'advance_trial_phase':
      if (!canAdvanceTrialPhase(state)) {
        return state;
      }

      return {
        ...state,
        trialPhase: NEXT_COUNTDOWN_PHASE[state.trialPhase],
      };

    case 'trial_ended':
      if (!canEndTrial(state)) {
        return state;
      }

      return { ...state, trialPhase: 'selfReport', errorMessage: null };

    case 'self_report_submitted':
      if (!canSubmitSelfReport(state)) {
        return state;
      }

      return {
        ...state,
        trialPhase: 'qualityCheck',
        selfReport: action.selfReport,
        suggestedQuality: action.suggestedQuality,
      };

    case 'trial_skipped':
      // The runner has already retired the trial on the backend (end +
      // quality-only finalize) before dispatching this; the state machine just
      // leaves the dead trial for the next one.
      if (state.phase !== 'running' || !SKIPPABLE_TRIAL_PHASES.includes(state.trialPhase)) {
        return state;
      }

      return {
        ...clearTrialReview(state),
        // A stale command failure must not ride along as the next trial's
        // in-stage notice.
        errorMessage: null,
        ...(isLastTrial(state)
          ? { phase: 'finished' as const, trialPhase: 'interTrial' as const }
          : { trialPhase: 'interTrial' as const }),
      };

    case 'artifact_flags_changed':
      if (state.phase !== 'running' || state.trialPhase !== 'qualityCheck') {
        return state;
      }

      return { ...state, artifactFlags: action.flags };

    case 'operator_notes_changed':
      if (state.phase !== 'running' || state.trialPhase !== 'qualityCheck') {
        return state;
      }

      return { ...state, operatorNotes: action.notes };

    case 'trial_finalized':
      if (!canConfirmQuality(state)) {
        return state;
      }

      return isLastTrial(state)
        ? { ...state, phase: 'finished', trialPhase: 'interTrial' }
        : { ...state, trialPhase: 'interTrial' };

    case 'end_session':
      if (!canEndSession(state)) {
        return state;
      }

      return {
        ...initialParadigmSessionState,
        // The setup panel stays mounted, so land back in setup instead of idle.
        phase: 'setup',
      };

    case 'command_failed':
      // Recoverable IPC failure (e.g. end_eeg_trial): keep the phase so the
      // operator can retry from the same stage.
      return { ...state, errorMessage: action.message };

    case 'session_failed':
      if (state.phase === 'idle' || state.phase === 'error') {
        return state;
      }

      return { ...state, phase: 'error', errorMessage: action.message };

    case 'reset_error':
      return { ...state, errorMessage: null };

    default:
      return state;
  }
}
