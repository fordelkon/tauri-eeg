import type { MentalScalePath } from '../../mentalScale/mentalScaleGate';
import type { RegulationEffectSummaryView } from '../../mentalScale/scaleRecordsApi';

/**
 * Pure state machine + view-model helpers for the effect-evaluation wizard
 * (基线 → 调控 → 调控后 → 结果). Kept free of React, Tauri, and DOM access so
 * the step gating, countdown math, and result copy are unit-testable in the
 * node vitest environment.
 */

export type EffectTargetEmotion = 'anxiety' | 'depression' | 'fear';

export type EffectRegulationMethod = 'music' | 'video';

export const EFFECT_EMOTION_OPTIONS = [
  { value: 'anxiety', label: '焦虑' },
  { value: 'depression', label: '抑郁' },
  { value: 'fear', label: '恐惧' },
] as const;

export const EFFECT_METHOD_OPTIONS = [
  { value: 'music', label: '音乐调控', path: '/music-regulation' },
  { value: 'video', label: '视频调控', path: '/video-regulation' },
] as const satisfies ReadonlyArray<{
  value: EffectRegulationMethod;
  label: string;
  path: MentalScalePath;
}>;

/** Wizard steps, in execution order. */
export const EFFECT_FLOW_STEPS = ['选择被试', '基线量表', '执行调控', '调控后量表', '结果评价'] as const;

export const EFFECT_FLOW_STEP_COUNT = EFFECT_FLOW_STEPS.length;

export type EffectFlowStep = 0 | 1 | 2 | 3 | 4;

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

const FLOW_STATE_VERSION = 2;

export type EffectEvaluationFlowState = {
  version: typeof FLOW_STATE_VERSION;
  step: EffectFlowStep;
  subjectId: string;
  emotion: EffectTargetEmotion;
  method: EffectRegulationMethod;
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

  return '本次调控跳过了剩余时长（已二次确认），改善率可能低估实际效果。';
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

export function serializeFlowState(state: EffectEvaluationFlowState): string {
  return JSON.stringify(state);
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

/* ------------------------------------------------------------------ */
/* Result view-model                                                   */
/* ------------------------------------------------------------------ */

/** Chinese copy when the summary cannot be computed yet; null when ready. */
export function describeMissingMeasurements(state: EffectEvaluationFlowState): string | null {
  const missing: string[] = [];

  if (!state.baselineRecordId) {
    missing.push('基线');
  }

  if (!state.postRecordId) {
    missing.push('调控后');
  }

  if (missing.length === 0) {
    return null;
  }

  return `缺少${missing.join('与')}量表记录，无法计算改善率。请完整走完 基线 → 调控 → 调控后 流程。`;
}

/** Signed percent with one decimal: +40%, -12.5%, 0%. */
export function formatImprovementRate(rate: number): string {
  const percent = Math.round(rate * 1000) / 10;
  const sign = percent > 0 ? '+' : '';

  return `${sign}${percent}%`;
}

export const EFFECT_DIMENSION_LABELS: Record<string, string> = {
  anxiety: '焦虑',
  energy: '精力',
  mood: '情绪',
  worry: '担忧',
};

export function labelForDimension(key: string): string {
  return EFFECT_DIMENSION_LABELS[key] ?? key;
}

export type EffectVerdictCopy = {
  severity: 'success' | 'warning';
  title: string;
  detail: string;
};

const THRESHOLD_PERCENT_LABEL = '10%';

export function buildEffectVerdictCopy(
  summary: Pick<RegulationEffectSummaryView, 'meanImprovementRate' | 'meetsThreshold'>,
): EffectVerdictCopy {
  if (summary.meanImprovementRate === null) {
    return {
      severity: 'warning',
      title: '无法判定调控效果',
      detail: '两次量表没有可对比的维度（维度缺失或基线为 0），请检查量表数据。',
    };
  }

  const meanText = formatImprovementRate(summary.meanImprovementRate);

  if (summary.meetsThreshold) {
    return {
      severity: 'success',
      title: '达到改善阈值',
      detail: `平均改善率 ${meanText}，不低于 ${THRESHOLD_PERCENT_LABEL} 的目标阈值，本次调控判定为有效。`,
    };
  }

  return {
    severity: 'warning',
    title: '未达到改善阈值',
    detail: `平均改善率 ${meanText}，低于 ${THRESHOLD_PERCENT_LABEL} 的目标阈值；负值表示情绪状态恶化。`,
  };
}
