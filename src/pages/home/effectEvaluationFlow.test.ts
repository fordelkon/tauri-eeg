import { describe, expect, it } from 'vitest';
import type { ParadigmVideoEntry } from '../../eeg/paradigm/types';
import {
  buildConditionComparisonVerdictCopy,
  buildEffectVerdictCopy,
  clearFlowStateFromStorage,
  CONDITION_COMPARISON_FORMULA_NOTE,
  createEffectEvaluationFlowState,
  describeInductionPoolStatus,
  describeMeasuredBasis,
  describeMissingMeasurements,
  describeRegulationSkipped,
  EFFECT_CONDITION_OPTIONS,
  EFFECT_FLOW_STEP_COUNT,
  EFFECT_FLOW_STEPS,
  formatCountdown,
  formatImprovementRate,
  isRegulationWindowOpen,
  isRegulationWindowOpenInStorage,
  labelForCondition,
  labelForDimension,
  paradigmPoolKeyForEmotion,
  parseFlowState,
  readFlowStateFromStorage,
  readRegulationPageContext,
  regulationDurationMs,
  regulationFinishModeFromRemaining,
  regulationPageContextFor,
  regulationPathForMethod,
  remainingRegulationSeconds,
  serializeFlowState,
  setupBlockingReason,
  writeFlowStateToStorage,
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

/* ------------------------------------------------------------------ */
/* R4/F4: regulation-page session context                              */
/* ------------------------------------------------------------------ */

/** In-memory sessionStorage stand-in for the node vitest environment. */
function fakeStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  };
}

/** A step-3 window that started at `startedAtMs` (5-minute default duration). */
function runningWindowState(startedAtMs = 1_000_000) {
  return {
    ...createEffectEvaluationFlowState(),
    step: 3 as const,
    subjectId: 'subj-042',
    emotion: 'anxiety' as const,
    method: 'music' as const,
    regulationStartedAtMs: startedAtMs,
  };
}

describe('regulation window detection (R4/F4)', () => {
  it('is only open on step 3 with a started wall clock', () => {
    expect(isRegulationWindowOpen(runningWindowState())).toBe(true);
    expect(isRegulationWindowOpen(createEffectEvaluationFlowState())).toBe(false);

    // Started the clock but still on an earlier/ later step: not "open".
    expect(isRegulationWindowOpen({ ...runningWindowState(), step: 2 })).toBe(false);
    expect(isRegulationWindowOpen({ ...runningWindowState(), step: 4 })).toBe(false);
  });

  it('stays open for both wizard conditions (R6: natural recovery also locks the shell)', () => {
    // The default state runs the natural-recovery condition.
    expect(isRegulationWindowOpen(runningWindowState())).toBe(true);
    expect(isRegulationWindowOpen({ ...runningWindowState(), condition: 'regulation' })).toBe(true);
  });

  it('round-trips through storage and clears cleanly', () => {
    const storage = fakeStorage();

    writeFlowStateToStorage(storage, runningWindowState());
    expect(isRegulationWindowOpenInStorage(storage)).toBe(true);
    expect(readFlowStateFromStorage(storage)?.subjectId).toBe('subj-042');

    clearFlowStateFromStorage(storage);
    expect(isRegulationWindowOpenInStorage(storage)).toBe(false);
    expect(readFlowStateFromStorage(storage)).toBeNull();
  });

  it('treats corrupt storage as a closed window instead of throwing', () => {
    expect(isRegulationWindowOpenInStorage(fakeStorage({
      'effectEvaluation.flowState.v1': '{broken',
    }))).toBe(false);
  });
});

describe('regulation page context (R4/F4 调控页消费会话上下文)', () => {
  const START = 1_000_000;
  const FIVE_MINUTES_MS = 300_000;

  it('exposes emotion label and remaining seconds for the matching live method', () => {
    const context = regulationPageContextFor(
      { ...runningWindowState(START), condition: 'regulation' as const },
      'music',
      START + 60_000,
    );

    expect(context).toEqual({ emotionLabel: '焦虑', remainingSeconds: 240 });
  });

  it('stays null for closed windows or a mismatched page method', () => {
    // The video page must stay untouched while a music run is live.
    expect(regulationPageContextFor(
      { ...runningWindowState(START), condition: 'regulation' as const },
      'video',
      START,
    )).toBeNull();
    // No live window: unrelated visits to the music page see nothing.
    expect(regulationPageContextFor(createEffectEvaluationFlowState(), 'music', START)).toBeNull();
    // Window finished long ago is still "open" until the wizard advances —
    // remaining clamps to 0 so the page keeps its playback stopped.
    expect(regulationPageContextFor(
      { ...runningWindowState(START), condition: 'regulation' as const },
      'music',
      START + FIVE_MINUTES_MS * 2,
    )).toEqual({ emotionLabel: '焦虑', remainingSeconds: 0 });
  });

  it('stays null for a live natural-recovery window (R6: that run never jumps)', () => {
    // The natural-recovery condition runs its countdown inside the wizard
    // page, so even the matching regulation page must never see a banner or
    // stop its playback for it.
    expect(regulationPageContextFor(runningWindowState(START), 'music', START + 60_000)).toBeNull();
    expect(regulationPageContextFor(runningWindowState(START), 'video', START + 60_000)).toBeNull();
  });

  it('reads through storage so the unmounted wizard state reaches the page', () => {
    const storage = fakeStorage();
    expect(readRegulationPageContext(storage, 'music', Date.now())).toBeNull();

    writeFlowStateToStorage(storage, {
      ...runningWindowState(START),
      emotion: 'fear' as const,
      method: 'video' as const,
      condition: 'regulation' as const,
    });

    expect(readRegulationPageContext(storage, 'music', START)).toBeNull();
    expect(readRegulationPageContext(storage, 'video', START + 30_000)).toEqual({
      emotionLabel: '恐惧',
      remainingSeconds: 270,
    });
  });
});

/* ------------------------------------------------------------------ */
/* R4/F1: measured-basis note                                          */
/* ------------------------------------------------------------------ */

describe('measured basis note (R4/F1 幻影维度口径)', () => {
  it('adds no copy when the mean covered only dimensions marked measured', () => {
    expect(describeMeasuredBasis({ measuredOnly: true })).toBeNull();
  });

  it('flags legacy pairs whose mean covers every stored key', () => {
    const note = describeMeasuredBasis({ measuredOnly: false });
    expect(note).toContain('未标注实测维度');
    expect(note).toContain('占位维度');
  });
});

/* ------------------------------------------------------------------ */
/* R6, 大纲 6.2: condition split, induction pool, cross-condition copy   */
/* ------------------------------------------------------------------ */

describe('wizard condition selection (R6 实验条件)', () => {
  it('defaults a fresh run to the natural-recovery baseline condition', () => {
    expect(createEffectEvaluationFlowState().condition).toBe('natural_recovery');
  });

  it('offers exactly the two outline conditions in Chinese', () => {
    expect(EFFECT_CONDITION_OPTIONS.map((option) => option.value)).toEqual([
      'natural_recovery',
      'regulation',
    ]);
    for (const option of EFFECT_CONDITION_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(labelForCondition(option.value)).toBe(option.label);
    }
  });

  it('labels legacy null rows as the old regulation flow instead of hiding them', () => {
    const legacy = labelForCondition(null);
    expect(legacy).toContain('调控条件');
    expect(legacy).toContain('legacy');
    // Unknown values stay readable rather than being coerced.
    expect(labelForCondition('sleep')).toBe('sleep');
  });

  it('round-trips the condition and rejects stored values outside the two options', () => {
    const regulation = { ...createEffectEvaluationFlowState(), condition: 'regulation' as const };
    expect(parseFlowState(serializeFlowState(regulation))?.condition).toBe('regulation');
    expect(parseFlowState(serializeFlowState(createEffectEvaluationFlowState()))?.condition)
      .toBe('natural_recovery');

    const valid = JSON.parse(serializeFlowState(createEffectEvaluationFlowState()));
    expect(parseFlowState(JSON.stringify({ ...valid, condition: 'sleep' }))).toBeNull();
    expect(parseFlowState(JSON.stringify({ ...valid, condition: null }))).toBeNull();
  });
});

describe('emotion induction pool gating (R6 素材池硬前置)', () => {
  const pool: ParadigmVideoEntry[] = [
    { videoId: 'anx-1', fileName: 'anx-1.mp4', absolutePath: 'C:\\clips\\anx-1.mp4' },
    { videoId: 'anx-2', fileName: 'anx-2.mp4', absolutePath: 'C:\\clips\\anx-2.mp4' },
  ];

  it('maps every wizard emotion onto its first-class paradigm pool (R8)', () => {
    expect(paradigmPoolKeyForEmotion('anxiety')).toBe('anxiety');
    expect(paradigmPoolKeyForEmotion('depression')).toBe('depression');
    expect(paradigmPoolKeyForEmotion('fear')).toBe('fear');
  });

  it('picks a pool entry deterministically for a usable pool', () => {
    expect(describeInductionPoolStatus('anxiety', pool, () => 1)).toEqual({
      kind: 'ready',
      entry: pool[1],
    });
    // An out-of-range pick wraps around the pool length.
    expect(describeInductionPoolStatus('anxiety', pool.slice(0, 1), () => 5)).toEqual({
      kind: 'ready',
      entry: pool[0],
    });
  });

  it('reads a fear pool as ready now that fear is a scheduled class (R8)', () => {
    const fearPool: ParadigmVideoEntry[] = [
      { videoId: 'fear-1', fileName: 'fear_01.mp4', absolutePath: 'C:\\clips\\fear_01.mp4' },
    ];

    const status = describeInductionPoolStatus('fear', fearPool, () => 0);
    expect(status).toEqual({ kind: 'ready', entry: fearPool[0] });
  });

  it('still blocks a fear run on a missing or empty pool without a silent skip', () => {
    const missing = describeInductionPoolStatus('fear', null, () => 0);
    expect(missing.kind).toBe('blocked');

    const empty = describeInductionPoolStatus('fear', [], () => 0);
    expect(empty.kind).toBe('blocked');
    if (empty.kind === 'blocked') {
      expect(empty.copy).toContain('素材池为空');
      expect(empty.copy).toContain('不提供跳过');
    }
  });

  it('blocks on a missing or empty pool with operator-facing reasons', () => {
    const missing = describeInductionPoolStatus('anxiety', null, () => 0);
    expect(missing.kind).toBe('blocked');
    if (missing.kind === 'blocked') {
      expect(missing.copy).toContain('素材库');
    }

    const empty = describeInductionPoolStatus('depression', [], () => 0);
    expect(empty.kind).toBe('blocked');
    if (empty.kind === 'blocked') {
      expect(empty.copy).toContain('素材池为空');
      expect(empty.copy).toContain('不提供跳过');
    }
  });
});

describe('cross-condition comparison copy (R6 跨条件对比)', () => {
  it('reports an undecidable verdict when no dimension is comparable', () => {
    const copy = buildConditionComparisonVerdictCopy({ meanImprovementRate: null, meetsThreshold: false });
    expect(copy.severity).toBe('warning');
    expect(copy.title).toBe('无法判定跨条件改善');
  });

  it('announces success when the regulation condition beats the threshold', () => {
    const copy = buildConditionComparisonVerdictCopy({ meanImprovementRate: 0.32, meetsThreshold: true });
    expect(copy.severity).toBe('success');
    expect(copy.title).toBe('调控条件优于基线条件（达标）');
    expect(copy.detail).toContain('+32%');
    expect(copy.detail).toContain('10%');
    expect(copy.detail).toContain('自然恢复');
  });

  it('warns below the threshold and explains negative rates', () => {
    const copy = buildConditionComparisonVerdictCopy({ meanImprovementRate: -0.05, meetsThreshold: false });
    expect(copy.severity).toBe('warning');
    expect(copy.title).toBe('调控条件未优于基线条件');
    expect(copy.detail).toContain('-5%');
    expect(copy.detail).toContain('不如自然恢复');
  });

  it('states the frozen formula note with its outline source', () => {
    expect(CONDITION_COMPARISON_FORMULA_NOTE).toContain('B_post');
    expect(CONDITION_COMPARISON_FORMULA_NOTE).toContain('T_post');
    expect(CONDITION_COMPARISON_FORMULA_NOTE).toContain('B-1');
  });
});
