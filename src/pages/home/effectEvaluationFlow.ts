import type { MentalScalePath } from '../../mentalScale/mentalScaleGate';
import type { RegulationEffectSummaryView } from '../../mentalScale/scaleRecordsApi';
import type { ConditionEffectComparisonView } from '../../mentalScale/scaleRecordsApi';
import type { ParadigmVideoEntry } from '../../eeg/paradigm/types';

/**
 * Pure state machine + view-model helpers for the effect-evaluation wizard
 * (设置 → 情绪诱发 → 诱发后量表 → 条件执行 → 条件后量表 → 结果评价).
 * Kept free of React, Tauri, and DOM access so the step gating, countdown
 * math, and result copy are unit-testable in the node vitest environment.
 */

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
/* Emotion induction (R6, 大纲 6.2)                                     */
/* ------------------------------------------------------------------ */

/**
 * video_paradigm library pool feeding the induction step for each target
 * emotion. R8: the library carries a first-class Fear pool (快乐素材已改造为
 * 恐惧占位), so every wizard emotion maps onto a scheduled class.
 */
export function paradigmPoolKeyForEmotion(
  emotion: EffectTargetEmotion,
): 'anxiety' | 'depression' | 'fear' {
  return emotion;
}

export type InductionPoolStatus =
  | { kind: 'ready'; entry: ParadigmVideoEntry }
  | { kind: 'blocked'; copy: string };

/**
 * Whether the induction step may play, derived from the target emotion and
 * the loaded pool (null = library missing/invalid). Every blocked case
 * carries an explicit operator-facing reason - the induction is a hard
 * precondition of the 大纲 flow, never silently skippable. Since R8 every
 * wizard emotion is a scheduled paradigm class, so the verdict depends only
 * on the pool; the emotion parameter stays on the contract for callers.
 *
 * `pickIndex` selects the pool entry (default: random) and is injectable so
 * tests stay deterministic.
 */
export function describeInductionPoolStatus(
  _emotion: EffectTargetEmotion,
  pool: readonly ParadigmVideoEntry[] | null,
  pickIndex: () => number = Math.random,
): InductionPoolStatus {
  if (pool === null) {
    return {
      kind: 'blocked',
      copy: '尚未加载有效的范式视频素材库（video_paradigm），无法播放诱发素材。请先在 EEG 采集页选择并校验素材库，再回到本页开始诱发。',
    };
  }

  if (pool.length === 0) {
    return {
      kind: 'blocked',
      copy: '该情绪类别的诱发素材池为空，无法播放诱发素材。请先在 EEG 采集页补充对应类别的素材，本步骤为流程硬前置，不提供跳过。',
    };
  }

  const index = pickIndex() % pool.length;
  return { kind: 'ready', entry: pool[index] };
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

  // phase='baseline' 的语义自 R6 起为“诱发后、条件前”（诱发步完成后、条件执行
  // 开始前测量）；文案保留“基线”叫法以与历史 phase 值一致。
  return `缺少${missing.join('与')}量表记录，无法计算改善率。请完整走完 诱发 → 诱发后量表 → 条件执行 → 条件后量表 流程。`;
}

/** Signed percent with one decimal: +40%, -12.5%, 0%. */
export function formatImprovementRate(rate: number): string {
  const percent = Math.round(rate * 1000) / 10;
  const sign = percent > 0 ? '+' : '';

  return `${sign}${percent}%`;
}

/**
 * Basis note under the result stats (F1 口径): a marker-based mean is the
 * honest default and needs no extra copy; a legacy pair computed over every
 * stored key must be flagged because it can include unmeasured placeholder
 * dimensions.
 */
export function describeMeasuredBasis(
  summary: Pick<RegulationEffectSummaryView, 'measuredOnly'>,
): string | null {
  return summary.measuredOnly
    ? null
    : '本次配对包含未标注实测维度的旧记录，按两侧全部已存维度计算，可能包含未实测的占位维度。';
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

/* ------------------------------------------------------------------ */
/* Cross-condition comparison copy (R6, 大纲 6.2)                       */
/* ------------------------------------------------------------------ */

/**
 * Formula note rendered with the cross-condition card: the outline froze
 * this default 口径 at B-1; it may be swapped before testing, so the UI
 * states its source instead of presenting it as an immutable fact.
 */
export const CONDITION_COMPARISON_FORMULA_NOTE =
  '改善口径：(B_post - T_post) / B_post，按维度取两条件 post 分之差再除以基线条件 post 分（大纲 B-1 冻结项，默认口径，测试前可换）。';

export function buildConditionComparisonVerdictCopy(
  comparison: Pick<ConditionEffectComparisonView, 'meanImprovementRate' | 'meetsThreshold'>,
): EffectVerdictCopy {
  if (comparison.meanImprovementRate === null) {
    return {
      severity: 'warning',
      title: '无法判定跨条件改善',
      detail: '两条件没有可对比的维度（维度缺失或基线条件 post 为 0），请检查量表数据。',
    };
  }

  const meanText = formatImprovementRate(comparison.meanImprovementRate);

  if (comparison.meetsThreshold) {
    return {
      severity: 'success',
      title: '调控条件优于基线条件（达标）',
      detail: `跨条件平均改善率 ${meanText}，不低于 ${THRESHOLD_PERCENT_LABEL} 阈值，调控条件的改善高于自然恢复基线条件。`,
    };
  }

  return {
    severity: 'warning',
    title: '调控条件未优于基线条件',
    detail: `跨条件平均改善率 ${meanText}，低于 ${THRESHOLD_PERCENT_LABEL} 阈值；负值表示调控后的情绪状态不如自然恢复。`,
  };
}
