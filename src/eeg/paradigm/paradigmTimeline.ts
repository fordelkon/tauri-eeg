/**
 * Timing constants and pure helpers describing the per-trial timeline:
 * baseline rest -> hint -> video -> post-video rest -> self report ->
 * quality check.
 */

export const BASELINE_REST_MS = 5000;
export const STARTING_HINT_MS = 2000;
export const POST_VIDEO_REST_MS = 5000;
export const VIDEO_MIN_SECONDS = 45;
export const VIDEO_MAX_SECONDS = 90;

/**
 * Regulation trial stages (closed-loop rehearsal, Li et al. 2024 template):
 * after the induction video the subject re-appraises for the regulation
 * window with no feedback on screen, then one intermittent feedback bar
 * (baseline vs regulation target-proximity) is shown for the display span.
 */
export const REGULATION_CUE_MS = 2000;
export const REGULATION_WINDOW_MS = 24000;
export const FEEDBACK_DISPLAY_MS = 2000;
/** Decode windows inside the regulation window (24 s / 2 s sliding windows). */
export const REGULATION_DECODE_STEPS = 12;

/**
 * Watchdog for the video stage: a missing file or stalled decoder can leave
 * the fullscreen stage black without any error event ever firing. Armed until
 * playback demonstrably advances; the grace on top of the spec's max duration
 * keeps slow disk/codec starts from tripping it.
 */
export const VIDEO_LOAD_WATCHDOG_MS = VIDEO_MAX_SECONDS * 1000 + 15_000;

export type ParadigmTrialPhase =
  | 'baseline'
  | 'hint'
  | 'video'
  | 'regulationCue'
  | 'regulationWindow'
  | 'feedback'
  | 'postRest'
  | 'selfReport'
  | 'qualityCheck';

/** Operator-facing order of the stages inside one induction trial. */
export const PARADIGM_TRIAL_PHASE_SEQUENCE: readonly ParadigmTrialPhase[] = [
  'baseline',
  'hint',
  'video',
  'postRest',
  'selfReport',
  'qualityCheck',
];

/**
 * Regulation trial stages: the induction video feeds the reappraisal window
 * directly (no post-video rest) and the trial ends after the intermittent
 * feedback display.
 */
export const PARADIGM_REGULATION_PHASE_SEQUENCE: readonly ParadigmTrialPhase[] = [
  'baseline',
  'hint',
  'video',
  'regulationCue',
  'regulationWindow',
  'feedback',
  'selfReport',
  'qualityCheck',
];

export const PARADIGM_TIMED_PHASES: readonly ParadigmTrialPhase[] = [
  'baseline',
  'hint',
  'postRest',
  'regulationCue',
  'regulationWindow',
  'feedback',
];

export function getNextTrialPhase(
  phase: ParadigmTrialPhase,
): ParadigmTrialPhase | null {
  const index = PARADIGM_TRIAL_PHASE_SEQUENCE.indexOf(phase);

  return index >= 0 && index < PARADIGM_TRIAL_PHASE_SEQUENCE.length - 1
    ? PARADIGM_TRIAL_PHASE_SEQUENCE[index + 1]
    : null;
}

/** Fixed wall-clock duration of the countdown-driven phases, null otherwise. */
export function getTimedPhaseDurationMs(
  phase: ParadigmTrialPhase,
): number | null {
  if (phase === 'baseline') {
    return BASELINE_REST_MS;
  }
  if (phase === 'hint') {
    return STARTING_HINT_MS;
  }
  if (phase === 'postRest') {
    return POST_VIDEO_REST_MS;
  }
  if (phase === 'regulationCue') {
    return REGULATION_CUE_MS;
  }
  if (phase === 'regulationWindow') {
    return REGULATION_WINDOW_MS;
  }
  if (phase === 'feedback') {
    return FEEDBACK_DISPLAY_MS;
  }
  return null;
}

export function isTimedPhase(phase: ParadigmTrialPhase) {
  return getTimedPhaseDurationMs(phase) !== null;
}

export function isVideoDurationOutOfRange(durationSeconds: number) {
  return durationSeconds < VIDEO_MIN_SECONDS || durationSeconds > VIDEO_MAX_SECONDS;
}

/**
 * Countdown display value is the whole-second ceiling of the remaining time,
 * which only moves once per second while ticks arrive far more often; on an
 * unchanged ceiling this returns the stored value so React's Object.is check
 * bails out of the state update and the fullscreen portal subtree skips the
 * otherwise-useless re-render (10 Hz -> 1 Hz for a 100 ms tick).
 */
export function coalesceCountdownTickMs(
  storedRemainingMs: number,
  measuredRemainingMs: number,
): number {
  return Math.ceil(measuredRemainingMs / 1000) === Math.ceil(storedRemainingMs / 1000)
    ? storedRemainingMs
    : measuredRemainingMs;
}
