import { describe, expect, it } from 'vitest';
import type { ParadigmVideoEntry } from '../../paradigm/types';
import {
  clearFlowStateFromStorage,
  createEffectEvaluationFlowState,
  describeInductionPoolStatus,
  describeRegulationSkipped,
  EFFECT_CONDITION_OPTIONS,
  EFFECT_FLOW_STEP_COUNT,
  EFFECT_FLOW_STEPS,
  formatCountdown,
  isRegulationWindowOpen,
  isRegulationWindowOpenInStorage,
  labelForCondition,
  paradigmPoolKeyForEmotion,
  parseFlowState,
  readFlowStateFromStorage,
  readRegulationPageContext,
  regulationDurationMs,
  regulationFinishModeFromRemaining,
  regulationPageContextFor,
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
    expect(state.durationMinutes).toBe(1);
    expect(state.subjectId).toBe('');
    expect(state.baselineRecordId).toBeNull();
    expect(state.postRecordId).toBeNull();
    expect(state.regulationStartedAtMs).toBeNull();
    expect(state.eventLogStatus).toBe('not-started');
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

  it('computes the regulation window from the configured minutes', () => {
    expect(regulationDurationMs({ ...createEffectEvaluationFlowState(), durationMinutes: 5 })).toBe(
      300_000,
    );
    expect(regulationDurationMs({ ...createEffectEvaluationFlowState(), durationMinutes: 1 })).toBe(
      60_000,
    );
  });
});

describe('regulation countdown', () => {
  it('has no countdown before the regulation started', () => {
    expect(remainingRegulationSeconds(createEffectEvaluationFlowState(), 1_000)).toBeNull();
  });

  it('counts down from the full window and clamps at zero afterwards', () => {
    const started = {
      ...createEffectEvaluationFlowState(),
      durationMinutes: 5,
      regulationStartedAtMs: 0,
    };

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
    expect(describeRegulationSkipped(skippedStarted)).toBe('本次体验提前结束，已记录跳过剩余时长。');
  });

  it('round-trips the skip marker and rejects corrupt stored values', () => {
    const skipped = {
      ...createEffectEvaluationFlowState(),
      regulationStartedAtMs: 1_000,
      regulationSkipped: true,
    };
    expect(parseFlowState(serializeFlowState(skipped))?.regulationSkipped).toBe(true);
    expect(
      parseFlowState(serializeFlowState(createEffectEvaluationFlowState()))?.regulationSkipped,
    ).toBe(false);

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
      eventLogStatus: 'active' as const,
    };

    expect(parseFlowState(serializeFlowState(state))).toEqual(state);
  });

  it('rejects corrupt payloads instead of restoring half-valid runs', () => {
    expect(parseFlowState(null)).toBeNull();
    expect(parseFlowState('')).toBeNull();
    expect(parseFlowState('not-json{')).toBeNull();
    expect(parseFlowState(JSON.stringify('string-root'))).toBeNull();

    const valid = JSON.parse(
      serializeFlowState({
        ...createEffectEvaluationFlowState(),
        subjectId: 'subj-042',
        baselineRecordId: 'rec-baseline',
      }),
    );

    const mutate = (patch: Record<string, unknown>) =>
      parseFlowState(JSON.stringify({ ...valid, ...patch }));

    // Any field outside its domain restarts the flow cleanly.
    expect(mutate({ version: 99 })).toBeNull();
    expect(mutate({ step: -1 })).toBeNull();
    expect(mutate({ step: EFFECT_FLOW_STEP_COUNT })).toBeNull();
    expect(mutate({ step: 1.5 })).toBeNull();
    expect(mutate({ subjectId: 42 })).toBeNull();
    expect(mutate({ emotion: 'anger' })).toBeNull();
    expect(mutate({ method: 'game' })).toBeNull();
    expect(mutate({ eventLogStatus: 'paused' })).toBeNull();
    expect(mutate({ baselineRecordId: 7 })).toBeNull();
    expect(mutate({ postRecordId: true })).toBeNull();
    expect(mutate({ regulationStartedAtMs: 'soon' })).toBeNull();
    expect(mutate({ regulationStartedAtMs: -5 })).toBeNull();
  });

  it('clamps an out-of-range stored duration back into the configurable band', () => {
    const restored = parseFlowState(
      JSON.stringify({
        ...createEffectEvaluationFlowState(),
        subjectId: 'subj-042',
        durationMinutes: 999,
      }),
    );
    expect(restored?.durationMinutes).toBe(30);

    const restoredLow = parseFlowState(
      JSON.stringify({
        ...createEffectEvaluationFlowState(),
        subjectId: 'subj-042',
        durationMinutes: 0.4,
      }),
    );
    expect(restoredLow?.durationMinutes).toBe(1);
  });
});

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
    durationMinutes: 5,
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
    expect(
      isRegulationWindowOpenInStorage(
        fakeStorage({
          'effectEvaluation.flowState.v1': '{broken',
        }),
      ),
    ).toBe(false);
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
    expect(
      regulationPageContextFor(
        { ...runningWindowState(START), condition: 'regulation' as const },
        'video',
        START,
      ),
    ).toBeNull();
    // No live window: unrelated visits to the music page see nothing.
    expect(regulationPageContextFor(createEffectEvaluationFlowState(), 'music', START)).toBeNull();
    // Window finished long ago is still "open" until the wizard advances —
    // remaining clamps to 0 so the page keeps its playback stopped.
    expect(
      regulationPageContextFor(
        { ...runningWindowState(START), condition: 'regulation' as const },
        'music',
        START + FIVE_MINUTES_MS * 2,
      ),
    ).toEqual({ emotionLabel: '焦虑', remainingSeconds: 0 });
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

  it('labels missing conditions without assigning a condition', () => {
    expect(labelForCondition(null)).toBe('—');
  });

  it('round-trips the condition and rejects stored values outside the two options', () => {
    const regulation = { ...createEffectEvaluationFlowState(), condition: 'regulation' as const };
    expect(parseFlowState(serializeFlowState(regulation))?.condition).toBe('regulation');
    expect(parseFlowState(serializeFlowState(createEffectEvaluationFlowState()))?.condition).toBe(
      'natural_recovery',
    );

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

  // Regression for the R8 hotfix: the production default pickIndex is
  // Math.random, whose value is FRACTIONAL in [0, 1). A bare modulo made
  // pool[index] undefined and crashed the induction step render (white
  // screen). Every injected picker in the older tests is an integer, which
  // is why this never surfaced in CI.
  it('survives the fractional Math.random default without crashing (R8 hotfix)', () => {
    const fearPool: ParadigmVideoEntry[] = [
      {
        videoId: 'fear-1',
        fileName: 'fear_01.mp4',
        absolutePath:
          'C:' + String.fromCharCode(92) + '\clips' + String.fromCharCode(92) + 'fear_01.mp4',
      },
      {
        videoId: 'fear-2',
        fileName: 'fear_02.mp4',
        absolutePath:
          'C:' + String.fromCharCode(92) + '\clips' + String.fromCharCode(92) + 'fear_02.mp4',
      },
      {
        videoId: 'fear-3',
        fileName: 'fear_03.mp4',
        absolutePath:
          'C:' + String.fromCharCode(92) + '\clips' + String.fromCharCode(92) + 'fear_03.mp4',
      },
    ];

    // No injected picker: exercises the real Math.random default.
    for (let round = 0; round < 50; round += 1) {
      const status = describeInductionPoolStatus('fear', fearPool);
      expect(status.kind).toBe('ready');
      if (status.kind === 'ready') {
        expect(fearPool).toContain(status.entry);
      }
    }

    // A fractional injected picker scales by the pool length.
    const fractional = describeInductionPoolStatus('fear', fearPool, () => 0.73);
    expect(fractional.kind).toBe('ready');
    if (fractional.kind === 'ready') {
      expect(fractional.entry).toEqual(fearPool[Math.floor(0.73 * fearPool.length)]);
    }
  });

  it('blocks when the pool is undefined at runtime, not just null (R8 hotfix)', () => {
    const stale = describeInductionPoolStatus('fear', undefined as unknown as null, () => 0);
    expect(stale.kind).toBe('blocked');
    if (stale.kind === 'blocked') {
      expect(stale.copy).toContain('素材库');
    }
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

describe('BioSemi effect run timing and persistence', () => {
  it('uses elapsed monotonic time even when the wall clock changes', () => {
    const state = {
      ...createEffectEvaluationFlowState(),
      durationMinutes: 5,
      regulationStartedAtMs: 100000,
      regulationStartedAtMonotonicMs: 1000,
    };
    expect(remainingRegulationSeconds(state, 99000000, 31000)).toBe(270);
    expect(remainingRegulationSeconds(state, 1, 301000)).toBe(0);
  });
  it('persists the external run identity independently of the legacy EEG session', () => {
    const state = {
      ...createEffectEvaluationFlowState(),
      runId: 'run-external-1',
      runMode: 'formal' as const,
      subjectId: 's-1',
    };
    const restored = parseFlowState(serializeFlowState(state));
    expect(restored?.runId).toBe('run-external-1');
    expect(restored?.runMode).toBe('formal');
  });
});
