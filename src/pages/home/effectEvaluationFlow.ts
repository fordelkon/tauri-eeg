import type { MentalScalePath } from '../../mentalScale/mentalScaleGate';

/**
 * Pure state machine + view-model helpers for the effect-evaluation wizard
 * (设置 → 情绪诱发 → 诱发后量表 → 条件执行 → 条件后量表 → 结果评价).
 * Kept free of React, Tauri, and DOM access so the step gating, countdown
 * math, and result copy are unit-testable in the node vitest environment.
 *
 * Two leaf modules split out of this machine (re-exported below so every
 * consumer keeps importing from here): `effectInductionPool.ts` (the
 * emotion-induction pool verdict) and `effectEvaluationResultCopy.ts` (the
 * result view-model copy).
 */

// Re-exports: the emotion-induction pool verdict (R6).
export {
  describeInductionPoolStatus,
  paradigmPoolKeyForEmotion,
} from './effectInductionPool';
export type { InductionPoolStatus } from './effectInductionPool';

// Re-exports: the result view-model copy (verdicts, basis notes, formulas).
export {
  buildConditionComparisonVerdictCopy,
  buildEffectVerdictCopy,
  CONDITION_COMPARISON_FORMULA_NOTE,
  describeMeasuredBasis,
  describeMissingMeasurements,
  EFFECT_DIMENSION_LABELS,
  formatImprovementRate,
  labelForDimension,
} from './effectEvaluationResultCopy';
export type { EffectVerdictCopy } from './effectEvaluationResultCopy';

export type EffectTargetEmotion = 'anxiety' | 'depression' | 'fear';

export type EffectRegulationMethod = 'music' | 'video';

/**
 * Wizard condition of a run (R6, 大纲 6.2): `natural_recovery` is the 基线
 * condition (诱发后不调控、自然恢复), `regulation` is the 调控 condition. Each
 * wizard session runs exactly one condition; the result step's
 * cross-condition comparison pairs one complete run of each condition.
 */
export type EffectCondition = 'natural_recovery' | 'regulation';

export const EFFECT_EMOTION_OPTIONS = [
  { value: 'anxiety', label: '焦虑' },
  { value: 'depression', label: '抑郁' },
  { value: 'fear', label: '恐惧' },
] as const;

export const EFFECT_CONDITION_OPTIONS = [
  { value: 'natural_recovery', label: '基线条件（自然恢复）' },
  { value: 'regulation', label: '调控条件' },
] as const satisfies ReadonlyArray<{
  value: EffectCondition;
  label: string;
}>;

export const EFFECT_METHOD_OPTIONS = [
  { value: 'music', label: '音乐调控', path: '/music-regulation' },
  { value: 'video', label: '视频调控', path: '/video-regulation' },
] as const satisfies ReadonlyArray<{
  value: EffectRegulationMethod;
  label: string;
  path: MentalScalePath;
}>;

/**
 * Chinese label for a run's condition; `null` marks pre-R6 legacy rows of
 * the old regulation-only flow, which consumers treat as the regulation
 * condition and label explicitly so exports/history stay honest.
 */
export function labelForCondition(condition: string | null): string {
  if (condition === null) {
    return '调控条件（legacy 旧流程）';
  }

  return EFFECT_CONDITION_OPTIONS.find((option) => option.value === condition)?.label
    ?? condition;
}

/** Wizard steps, in execution order. */
export const EFFECT_FLOW_STEPS = [
  '选择被试',
  '情绪诱发',
  '诱发后量表',
  '条件执行',
  '条件后量表',
  '结果评价',
] as const;

export const EFFECT_FLOW_STEP_COUNT = EFFECT_FLOW_STEPS.length;

export type EffectFlowStep = 0 | 1 | 2 | 3 | 4 | 5;

export const DEFAULT_REGULATION_MINUTES = 5;
export const MIN_REGULATION_MINUTES = 1;
export const MAX_REGULATION_MINUTES = 30;

/**
 * EEG association status for the regulation leg. The recording is only
 * started when the device can record at that moment; anything else degrades
 * to `unavailable` without blocking the loop.
 */
export type EffectEegAssociation = 'not-started' | 'recording' | 'saved' | 'unavailable';

const EEG_ASSOCIATION_VALUES: EffectEegAssociation[] = [
  'not-started',
  'recording',
  'saved',
  'unavailable',
];

const FLOW_STATE_VERSION = 3;

export type EffectEvaluationFlowState = {
  version: typeof FLOW_STATE_VERSION;
  step: EffectFlowStep;
  subjectId: string;
  emotion: EffectTargetEmotion;
  method: EffectRegulationMethod;
  /**
   * Wizard condition of this run (R6): 基线条件（自然恢复） or 调控条件. The
   * 大纲-aligned flow runs the natural-recovery condition first, so it is the
   * default; records saved without a condition are pre-R6 legacy rows that
   * consumers already treat as the regulation condition.
   */
  condition: EffectCondition;
  durationMinutes: number;
  baselineRecordId: string | null;
  postRecordId: string | null;
  regulationStartedAtMs: number | null;
  /** True when the operator explicitly skipped part of the window. */
  regulationSkipped: boolean;
  eegSessionId: string | null;
  eegAssociation: EffectEegAssociation;
};

export function createEffectEvaluationFlowState(): EffectEvaluationFlowState {
  return {
    version: FLOW_STATE_VERSION,
    step: 0,
    subjectId: '',
    emotion: 'anxiety',
    method: 'music',
    condition: 'natural_recovery',
    durationMinutes: DEFAULT_REGULATION_MINUTES,
    baselineRecordId: null,
    postRecordId: null,
    regulationStartedAtMs: null,
    regulationSkipped: false,
    eegSessionId: null,
    eegAssociation: 'not-started',
  };
}

/** The setup step blocks on one field only: a non-empty subject id. */
export function setupBlockingReason(state: EffectEvaluationFlowState): string | null {
  if (state.subjectId.trim().length === 0) {
    return '请填写被试 ID，量表记录需要绑定被试。';
  }

  return null;
}

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
): number | null {
  if (state.regulationStartedAtMs === null) {
    return null;
  }

  const elapsedMs = Math.max(0, nowMs - state.regulationStartedAtMs);
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
/* Session persistence (survives the jump to the regulation page)      */
/* ------------------------------------------------------------------ */

/** sessionStorage key shared by the wizard and every context consumer
 * (regulation pages, paradigm start gate). */
export const FLOW_STORAGE_KEY = 'effectEvaluation.flowState.v1';

/** Minimal storage surface so node tests can pass plain objects. */
type FlowStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readFlowStateFromStorage(
  storage: Pick<FlowStorage, 'getItem'>,
): EffectEvaluationFlowState | null {
  try {
    return parseFlowState(storage.getItem(FLOW_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function serializeFlowState(state: EffectEvaluationFlowState): string {
  return JSON.stringify(state);
}

/** Best-effort write; an unavailable storage just disables run resume. */
export function writeFlowStateToStorage(storage: FlowStorage, state: EffectEvaluationFlowState): void {
  try {
    storage.setItem(FLOW_STORAGE_KEY, serializeFlowState(state));
  } catch {
    // Ignore.
  }
}

export function clearFlowStateFromStorage(storage: FlowStorage): void {
  try {
    storage.removeItem(FLOW_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

/**
 * True while the condition-execution step's wall-clock window is running
 * (started, not yet left). This is the "a run leg is happening right now"
 * fact consumed by the mutual-exclusion guards (shell navigation, paradigm
 * start) - it holds for both conditions so a natural-recovery run blocks a
 * paradigm session just like a regulation run does.
 */
export function isRegulationWindowOpen(state: EffectEvaluationFlowState): boolean {
  return state.step === 3 && state.regulationStartedAtMs !== null;
}

export function isRegulationWindowOpenInStorage(storage: FlowStorage): boolean {
  const state = readFlowStateFromStorage(storage);
  return state !== null && isRegulationWindowOpen(state);
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

/** Parses stored wizard state; any stale or corrupt payload yields null so
 * the flow restarts cleanly instead of restoring half-valid data. */
export function parseFlowState(raw: string | null | undefined): EffectEvaluationFlowState | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;

  if (candidate.version !== FLOW_STATE_VERSION) {
    return null;
  }

  const step = candidate.step;
  if (
    typeof step !== 'number'
    || !Number.isInteger(step)
    || step < 0
    || step >= EFFECT_FLOW_STEP_COUNT
  ) {
    return null;
  }

  const subjectId = candidate.subjectId;
  if (typeof subjectId !== 'string') {
    return null;
  }

  const emotion = EFFECT_EMOTION_OPTIONS.find((option) => option.value === candidate.emotion)?.value;
  if (!emotion) {
    return null;
  }

  const method = EFFECT_METHOD_OPTIONS.find((option) => option.value === candidate.method)?.value;
  if (!method) {
    return null;
  }

  const condition = EFFECT_CONDITION_OPTIONS.find(
    (option) => option.value === candidate.condition,
  )?.value;
  if (!condition) {
    return null;
  }

  const durationMinutes = clampDurationMinutes(candidate.durationMinutes);

  const baselineRecordId = optionalString(candidate.baselineRecordId);
  if (baselineRecordId === undefined) {
    return null;
  }

  const postRecordId = optionalString(candidate.postRecordId);
  if (postRecordId === undefined) {
    return null;
  }

  let regulationStartedAtMs: number | null = null;
  if (candidate.regulationStartedAtMs !== null) {
    if (
      typeof candidate.regulationStartedAtMs !== 'number'
      || !Number.isFinite(candidate.regulationStartedAtMs)
      || candidate.regulationStartedAtMs <= 0
    ) {
      return null;
    }

    regulationStartedAtMs = candidate.regulationStartedAtMs;
  }

  if (typeof candidate.regulationSkipped !== 'boolean') {
    return null;
  }
  const regulationSkipped: boolean = candidate.regulationSkipped;

  const eegSessionId = optionalString(candidate.eegSessionId);
  if (eegSessionId === undefined) {
    return null;
  }

  const eegAssociation = EEG_ASSOCIATION_VALUES.find((value) => value === candidate.eegAssociation);
  if (!eegAssociation) {
    return null;
  }

  return {
    version: FLOW_STATE_VERSION,
    step: step as EffectFlowStep,
    subjectId,
    emotion,
    method,
    condition,
    durationMinutes,
    baselineRecordId,
    postRecordId,
    regulationStartedAtMs,
    regulationSkipped,
    eegSessionId,
    eegAssociation,
  };
}

function optionalString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === 'string' ? value : undefined;
}

function clampDurationMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_REGULATION_MINUTES;
  }

  return Math.min(MAX_REGULATION_MINUTES, Math.max(MIN_REGULATION_MINUTES, Math.round(value)));
}

