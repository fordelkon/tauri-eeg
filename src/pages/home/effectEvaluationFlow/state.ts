import {
  DEFAULT_REGULATION_MINUTES,
  DEFAULT_REST_MINUTES,
  EFFECT_CONDITION_OPTIONS,
  EFFECT_EMOTION_OPTIONS,
  EFFECT_FLOW_STEP_COUNT,
  EFFECT_METHOD_OPTIONS,
  MAX_REGULATION_MINUTES,
  MIN_REGULATION_MINUTES,
  type EffectCondition,
  type EffectFlowStep,
  type EffectRegulationMethod,
  type EffectTargetEmotion,
} from './constants';

/**
 * The wizard's serializable state plus its strict storage parser: any
 * stale or corrupt payload yields null so the flow restarts cleanly instead
 * of restoring half-valid data.
 */
/**
 * experiment event log status for the regulation leg. The recording is only
 * started when the device can record at that moment; anything else degrades
 * to `unavailable` without blocking the loop.
 */
export type EffectEventLogStatus = 'not-started' | 'active' | 'saved' | 'interrupted';

const EVENT_LOG_STATUS_VALUES: EffectEventLogStatus[] = [
  'not-started',
  'active',
  'saved',
  'interrupted',
];

const FLOW_STATE_VERSION = 7;

export type EffectEvaluationFlowState = {
  version: typeof FLOW_STATE_VERSION;
  step: EffectFlowStep;
  subjectId: string;
  emotion: EffectTargetEmotion;
  method: EffectRegulationMethod;
  condition: EffectCondition;
  durationMinutes: number;
  preInductionRecordId: string | null;
  baselineRecordId: string | null;
  postRecordId: string | null;
  regulationStartedAtMs: number | null;
  /** True when the operator explicitly skipped part of the window. */
  regulationSkipped: boolean;
  runId: string | null;
  runMode: 'formal' | 'rehearsal';
  interrupted: boolean;
  regulationStartedAtMonotonicMs: number | null;
  eventLogStatus: EffectEventLogStatus;
};

export function createEffectEvaluationFlowState(): EffectEvaluationFlowState {
  return {
    version: FLOW_STATE_VERSION,
    step: 0,
    subjectId: '',
    emotion: 'anxiety',
    method: 'music',
    condition: 'natural_recovery',
    durationMinutes: DEFAULT_REST_MINUTES,
    preInductionRecordId: null,
    baselineRecordId: null,
    postRecordId: null,
    regulationStartedAtMs: null,
    regulationSkipped: false,
    runId: null,
    runMode: __EXPERIMENT_DEV__ ? 'rehearsal' : 'formal',
    interrupted: false,
    regulationStartedAtMonotonicMs: null,
    eventLogStatus: 'not-started',
  };
}

/** The setup step blocks on one field only: a non-empty subject id. */
export function setupBlockingReason(state: EffectEvaluationFlowState): string | null {
  if (state.subjectId.trim().length === 0) {
    return '请填写被试 ID，量表记录需要绑定被试。';
  }

  return null;
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
    typeof step !== 'number' ||
    !Number.isInteger(step) ||
    step < 0 ||
    step >= EFFECT_FLOW_STEP_COUNT
  ) {
    return null;
  }

  const subjectId = candidate.subjectId;
  const preInductionRecordId = optionalString(candidate.preInductionRecordId);
  if (preInductionRecordId === undefined) return null;
  if (typeof subjectId !== 'string') {
    return null;
  }

  const emotion = EFFECT_EMOTION_OPTIONS.find(
    (option) => option.value === candidate.emotion,
  )?.value;
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
      typeof candidate.regulationStartedAtMs !== 'number' ||
      !Number.isFinite(candidate.regulationStartedAtMs) ||
      candidate.regulationStartedAtMs <= 0
    ) {
      return null;
    }

    regulationStartedAtMs = candidate.regulationStartedAtMs;
  }

  if (typeof candidate.regulationSkipped !== 'boolean') {
    return null;
  }
  const regulationSkipped: boolean = candidate.regulationSkipped;

  const runId = optionalString(candidate.runId);
  if (
    runId === undefined ||
    !(
      candidate.runMode === 'formal' ||
      (__EXPERIMENT_DEV__ && candidate.runMode === 'rehearsal')
    ) ||
    typeof candidate.interrupted !== 'boolean'
  )
    return null;
  const monotonic = candidate.regulationStartedAtMonotonicMs;
  if (monotonic !== null && (typeof monotonic !== 'number' || !Number.isFinite(monotonic)))
    return null;

  const eventLogStatus = EVENT_LOG_STATUS_VALUES.find(
    (value) => value === candidate.eventLogStatus,
  );
  if (!eventLogStatus) {
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
    preInductionRecordId,
    baselineRecordId,
    postRecordId,
    regulationStartedAtMs,
    regulationSkipped,
    runId,
    runMode: candidate.runMode,
    interrupted: candidate.interrupted,
    regulationStartedAtMonotonicMs: monotonic,
    eventLogStatus,
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
