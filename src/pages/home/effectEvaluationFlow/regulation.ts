import type { MentalScalePath } from '../../../mentalScale/mentalScaleGate';
import {
  EFFECT_EMOTION_OPTIONS,
  EFFECT_METHOD_OPTIONS,
  type EffectRegulationMethod,
} from './constants';
import type { EffectEvaluationFlowState } from './state';
import { isRegulationWindowOpen, readFlowStateFromStorage, type FlowStorage } from './storage';

/**
 * Regulation-window timing, countdown math, and the regulation-page context
 * consumed by the music/video pages while a window is live.
 */
export function regulationPathForMethod(method: EffectRegulationMethod): MentalScalePath {
  return EFFECT_METHOD_OPTIONS.find((option) => option.value === method)?.path ?? '/music-regulation';
}

export function regulationDurationMs(state: EffectEvaluationFlowState): number {
  return state.durationMinutes * 60_000;
}

/** Seconds left in the regulation window (null before it started). */
export function remainingRegulationSeconds(
  state: EffectEvaluationFlowState,
  nowMs: number,
  monotonicNowMs?: number,
): number | null {
  if (state.regulationStartedAtMs === null) {
    return null;
  }

  const elapsedMs = Math.max(0, monotonicNowMs !== undefined && state.regulationStartedAtMonotonicMs !== null
    ? monotonicNowMs - state.regulationStartedAtMonotonicMs
    : nowMs - state.regulationStartedAtMs);
  return Math.max(0, Math.ceil((regulationDurationMs(state) - elapsedMs) / 1000));
}

/* ------------------------------------------------------------------ */
/* Strong duration constraint                                          */
/* ------------------------------------------------------------------ */

/**
 * How the regulation step may exit, derived from the remaining time. The
 * countdown is a hard floor: `finish` unlocks only once it reaches zero,
 * and leaving early requires the double-confirmed skip flow.
 */
export type RegulationFinishMode =
  | { mode: 'not-started' }
  | { mode: 'finish' }
  | { mode: 'requires-skip'; remainingSeconds: number };

export function regulationFinishModeFromRemaining(
  remainingSeconds: number | null,
): RegulationFinishMode {
  if (remainingSeconds === null) {
    return { mode: 'not-started' };
  }

  return remainingSeconds === 0
    ? { mode: 'finish' }
    : { mode: 'requires-skip', remainingSeconds };
}

/** Warning copy shown after a confirmed skip; null while unskipped. */
export function describeRegulationSkipped(state: EffectEvaluationFlowState): string | null {
  if (!state.regulationSkipped || state.regulationStartedAtMs === null) {
    return null;
  }

  return '本次条件执行跳过了剩余时长（已二次确认），改善率可能低估实际效果。';
}

/** mm:ss countdown text; negative or non-finite input clamps to 00:00. */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds) && totalSeconds > 0
    ? Math.floor(totalSeconds)
    : 0;
  const minutes = Math.floor(seconds / 60);

  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
/* ------------------------------------------------------------------ */
/* Regulation-page context (F4)                                        */
/* ------------------------------------------------------------------ */

export type RegulationPageContext = {
  emotionLabel: string;
  /** Seconds left in the window; 0 once the target duration is reached. */
  remainingSeconds: number;
};

/**
 * View-model for a regulation page playing this run's content: only live
 * regulation-condition windows whose method matches the page expose a
 * context, so unrelated visits to the music/video pages stay untouched and
 * natural-recovery runs (which never leave the wizard page) never trigger
 * the regulation-page banner/stop logic.
 */
export function regulationPageContextFor(
  state: EffectEvaluationFlowState,
  method: EffectRegulationMethod,
  nowMs: number,
): RegulationPageContext | null {
  if (
    !isRegulationWindowOpen(state)
    || state.condition !== 'regulation'
    || state.method !== method
  ) {
    return null;
  }

  return {
    emotionLabel: EFFECT_EMOTION_OPTIONS.find((option) => option.value === state.emotion)?.label
      ?? state.emotion,
    remainingSeconds: remainingRegulationSeconds(state, nowMs) ?? 0,
  };
}

export function readRegulationPageContext(
  storage: Pick<FlowStorage, 'getItem'>,
  method: EffectRegulationMethod,
  nowMs: number,
): RegulationPageContext | null {
  const state = readFlowStateFromStorage(storage);
  return state === null ? null : regulationPageContextFor(state, method, nowMs);
}

