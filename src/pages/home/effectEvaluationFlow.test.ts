import { describe, expect, it } from 'vitest';
import {
  buildEffectVerdictCopy,
  createEffectEvaluationFlowState,
  describeMissingMeasurements,
  describeRegulationSkipped,
  EFFECT_FLOW_STEP_COUNT,
  EFFECT_FLOW_STEPS,
  formatCountdown,
  formatImprovementRate,
  labelForDimension,
  parseFlowState,
  regulationDurationMs,
  regulationFinishModeFromRemaining,
  regulationPathForMethod,
  remainingRegulationSeconds,
  serializeFlowState,
  setupBlockingReason,
} from './effectEvaluationFlow';

/**
 * The wizard's step gating, countdown math, resume parsing, and result copy
 * are pure functions — these tests pin the state machine without React or
 * Tauri, in the node vitest environment.
 */

describe('effectEvaluationFlow stepper', () => {
  it('starts at the subject-selection step with the default duration', () => {
    const state = createEffectEvaluationFlowState();

    expect(state.step).toBe(0);
    expect(state.durationMinutes).toBe(5);
    expect(state.subjectId).toBe('');
    expect(state.baselineRecordId).toBeNull();
    expect(state.postRecordId).toBeNull();
    expect(state.regulationStartedAtMs).toBeNull();
    expect(state.eegAssociation).toBe('not-started');
    expect(EFFECT_FLOW_STEPS).toHaveLength(EFFECT_FLOW_STEP_COUNT);
    expect(EFFECT_FLOW_STEPS[0]).toBe('选择被试');
    expect(EFFECT_FLOW_STEPS[EFFECT_FLOW_STEP_COUNT - 1]).toBe('结果评价');
  });

  it('blocks the setup step on a blank subject id and passes a filled one', () => {
    const blank = createEffectEvaluationFlowState();
    expect(setupBlockingReason(blank)).toContain('被试 ID');

    const whitespaceOnly = { ...blank, subjectId: '   ' };
    expect(setupBlockingReason(whitespaceOnly)).toContain('被试 ID');

    const filled = { ...blank, subjectId: 'subj-001' };
    expect(setupBlockingReason(filled)).toBeNull();
  });

  it('maps each regulation method onto its page path with a safe fallback', () => {
    expect(regulationPathForMethod('music')).toBe('/music-regulation');
    expect(regulationPathForMethod('video')).toBe('/video-regulation');
  });

  it('computes the regulation window from the configured minutes', () => {
    expect(regulationDurationMs({ ...createEffectEvaluationFlowState(), durationMinutes: 5 })).toBe(300_000);
    expect(regulationDurationMs({ ...createEffectEvaluationFlowState(), durationMinutes: 1 })).toBe(60_000);
  });
});

describe('regulation countdown', () => {
  it('has no countdown before the regulation started', () => {
    expect(remainingRegulationSeconds(createEffectEvaluationFlowState(), 1_000)).toBeNull();
  });

  it('counts down from the full window and clamps at zero afterwards', () => {
    const started = { ...createEffectEvaluationFlowState(), regulationStartedAtMs: 0 };

    expect(remainingRegulationSeconds(started, 0)).toBe(300);
    // Halfway through a 5-minute window: 150s left (ceil keeps whole seconds).
    expect(remainingRegulationSeconds(started, 150_000)).toBe(150);
    // Clock running backwards never extends the window.
    expect(remainingRegulationSeconds(started, 299_500)).toBe(1);
    expect(remainingRegulationSeconds(started, 400_000)).toBe(0);
  });

  it('formats mm:ss text and clamps invalid input to 00:00', () => {
    expect(formatCountdown(300)).toBe('05:00');
    expect(formatCountdown(65)).toBe('01:05');
    expect(formatCountdown(9)).toBe('00:09');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-3)).toBe('00:00');
    expect(formatCountdown(Number.NaN)).toBe('00:00');
  });
});

describe('strong duration constraint (R3)', () => {
  it('keeps the exit locked before the countdown starts', () => {
    expect(regulationFinishModeFromRemaining(null)).toEqual({ mode: 'not-started' });
  });

  it('unlocks the normal finish only when the countdown reaches zero', () => {
    expect(regulationFinishModeFromRemaining(0)).toEqual({ mode: 'finish' });
  });

  it('forces the double-confirmed skip path while time remains', () => {
    expect(regulationFinishModeFromRemaining(1)).toEqual({
      mode: 'requires-skip',
      remainingSeconds: 1,
    });
    expect(regulationFinishModeFromRemaining(300)).toEqual({
      mode: 'requires-skip',
      remainingSeconds: 300,
    });
  });

  it('surfaces the skip warning copy only for a started run that was skipped', () => {
    const state = createEffectEvaluationFlowState();
    expect(describeRegulationSkipped(state)).toBeNull();

    // The marker without a started regulation leg is meaningless.
    const skippedNotStarted = { ...state, regulationSkipped: true };
    expect(describeRegulationSkipped(skippedNotStarted)).toBeNull();

    const skippedStarted = { ...skippedNotStarted, regulationStartedAtMs: 1_000 };
    const copy = describeRegulationSkipped(skippedStarted);
    expect(copy).toContain('跳过');
    expect(copy).toContain('二次确认');
  });

  it('round-trips the skip marker and rejects corrupt stored values', () => {
    const skipped = {
      ...createEffectEvaluationFlowState(),
      regulationStartedAtMs: 1_000,
      regulationSkipped: true,
    };
    expect(parseFlowState(serializeFlowState(skipped))?.regulationSkipped).toBe(true);
    expect(parseFlowState(serializeFlowState(createEffectEvaluationFlowState()))?.regulationSkipped)
      .toBe(false);

    const valid = JSON.parse(serializeFlowState(createEffectEvaluationFlowState()));
    expect(parseFlowState(JSON.stringify({ ...valid, regulationSkipped: 'yes' }))).toBeNull();
  });
});

describe('flow state persistence across the regulation-page jump', () => {
  it('round-trips a full run through serialize/parse unchanged', () => {
    const state = {
      ...createEffectEvaluationFlowState(),
      step: 2 as const,
      subjectId: 'subj-042',
      emotion: 'fear' as const,
      method: 'video' as const,
      durationMinutes: 10,
      baselineRecordId: 'rec-baseline',
      regulationStartedAtMs: 1_720_000_000_000,
      eegAssociation: 'recording' as const,
    };

    expect(parseFlowState(serializeFlowState(state))).toEqual(state);
  });

  it('rejects corrupt payloads instead of restoring half-valid runs', () => {
    expect(parseFlowState(null)).toBeNull();
    expect(parseFlowState('')).toBeNull();
    expect(parseFlowState('not-json{')).toBeNull();
    expect(parseFlowState(JSON.stringify('string-root'))).toBeNull();

    const valid = JSON.parse(serializeFlowState({
      ...createEffectEvaluationFlowState(),
      subjectId: 'subj-042',
      baselineRecordId: 'rec-baseline',
    }));

    const mutate = (patch: Record<string, unknown>) => parseFlowState(
      JSON.stringify({ ...valid, ...patch }),
    );

    // Any field outside its domain restarts the flow cleanly.
    expect(mutate({ version: 99 })).toBeNull();
    expect(mutate({ step: -1 })).toBeNull();
    expect(mutate({ step: EFFECT_FLOW_STEP_COUNT })).toBeNull();
    expect(mutate({ step: 1.5 })).toBeNull();
    expect(mutate({ subjectId: 42 })).toBeNull();
    expect(mutate({ emotion: 'anger' })).toBeNull();
    expect(mutate({ method: 'game' })).toBeNull();
    expect(mutate({ eegAssociation: 'paused' })).toBeNull();
    expect(mutate({ baselineRecordId: 7 })).toBeNull();
    expect(mutate({ postRecordId: true })).toBeNull();
    expect(mutate({ regulationStartedAtMs: 'soon' })).toBeNull();
    expect(mutate({ regulationStartedAtMs: -5 })).toBeNull();
  });

  it('clamps an out-of-range stored duration back into the configurable band', () => {
    const restored = parseFlowState(JSON.stringify({
      ...createEffectEvaluationFlowState(),
      subjectId: 'subj-042',
      durationMinutes: 999,
    }));
    expect(restored?.durationMinutes).toBe(30);

    const restoredLow = parseFlowState(JSON.stringify({
      ...createEffectEvaluationFlowState(),
      subjectId: 'subj-042',
      durationMinutes: 0.4,
    }));
    expect(restoredLow?.durationMinutes).toBe(1);
  });
});

describe('missing-measurement guard (异常分支)', () => {
  it('names every missing phase when neither record exists', () => {
    const copy = describeMissingMeasurements(createEffectEvaluationFlowState());
    expect(copy).toContain('基线与调控后');
    expect(copy).toContain('无法计算改善率');
  });

  it('names only the missing phase when one record was saved', () => {
    const onlyBaseline = {
      ...createEffectEvaluationFlowState(),
      baselineRecordId: 'rec-baseline',
    };
    const postMissing = describeMissingMeasurements(onlyBaseline);
    expect(postMissing).toContain('缺少调控后');
    expect(postMissing).not.toContain('缺少基线');

    const onlyPost = {
      ...createEffectEvaluationFlowState(),
      postRecordId: 'rec-post',
    };
    const baselineMissing = describeMissingMeasurements(onlyPost);
    expect(baselineMissing).toContain('缺少基线');
    expect(baselineMissing).not.toContain('缺少调控后');
  });

  it('returns null once both records are paired so the summary may load', () => {
    const complete = {
      ...createEffectEvaluationFlowState(),
      baselineRecordId: 'rec-baseline',
      postRecordId: 'rec-post',
    };
    expect(describeMissingMeasurements(complete)).toBeNull();
  });
});

describe('improvement display logic', () => {
  it('formats signed percents with one decimal', () => {
    expect(formatImprovementRate(0.4)).toBe('+40%');
    expect(formatImprovementRate(0.4567)).toBe('+45.7%');
    expect(formatImprovementRate(-0.125)).toBe('-12.5%');
    expect(formatImprovementRate(0)).toBe('0%');
  });

  it('labels known dimensions in Chinese and keeps unknown keys readable', () => {
    expect(labelForDimension('anxiety')).toBe('焦虑');
    expect(labelForDimension('mood')).toBe('情绪');
    expect(labelForDimension('energy')).toBe('精力');
    expect(labelForDimension('worry')).toBe('担忧');
    expect(labelForDimension('custom-scale-key')).toBe('custom-scale-key');
  });

  it('reports an undecidable verdict when no dimension is comparable', () => {
    const copy = buildEffectVerdictCopy({ meanImprovementRate: null, meetsThreshold: false });
    expect(copy.severity).toBe('warning');
    expect(copy.title).toBe('无法判定调控效果');
  });

  it('announces success at or above the 10% threshold', () => {
    const copy = buildEffectVerdictCopy({ meanImprovementRate: 0.32, meetsThreshold: true });
    expect(copy.severity).toBe('success');
    expect(copy.title).toBe('达到改善阈值');
    expect(copy.detail).toContain('+32%');
    expect(copy.detail).toContain('10%');
  });

  it('warns below the threshold and explains negative rates', () => {
    const copy = buildEffectVerdictCopy({ meanImprovementRate: -0.05, meetsThreshold: false });
    expect(copy.severity).toBe('warning');
    expect(copy.title).toBe('未达到改善阈值');
    expect(copy.detail).toContain('-5%');
  });
});
