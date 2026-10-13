import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConditionCountdown } from './EffectConditionCountdown';
import { createEffectEvaluationFlowState } from './effectEvaluationFlow';

describe('ConditionCountdown (Resting EEG Fixation Cross & Regulation Clock)', () => {
  it('renders neurophysiology fixation cross and soft instruction for natural_recovery condition', () => {
    const state = createEffectEvaluationFlowState();
    state.condition = 'natural_recovery';
    state.durationMinutes = 5;
    state.regulationStartedAtMs = Date.now();
    state.regulationStartedAtMonotonicMs = performance.now();

    const html = renderToStaticMarkup(
      createElement(ConditionCountdown, {
        state,
        windowNoun: '自然恢复',
        onElapsed: () => undefined,
      }),
    );

    // Fixation cross and soft instruction must be prominently present
    expect(html).toContain('静息态注视中央十字');
    expect(html).toContain('+');
    expect(html).toContain('请注视中央十字，身心放松，减少眨眼与头动');

    // Big jumping countdownValue must NOT be present in natural recovery
    expect(html).not.toMatch(/class="[^"]*countdownValue[^"]*"/);

    // Subdued secondary corner countdown must be present instead
    expect(html).toMatch(/class="[^"]*restingCountdownCorner[^"]*"/);
    expect(html).toContain('自然恢复静息记录中');
  });

  it('renders standard countdown value for regulation condition without fixation cross', () => {
    const state = createEffectEvaluationFlowState();
    state.condition = 'regulation';
    state.durationMinutes = 5;
    state.regulationStartedAtMs = Date.now();
    state.regulationStartedAtMonotonicMs = performance.now();

    const html = renderToStaticMarkup(
      createElement(ConditionCountdown, {
        state,
        windowNoun: '调控',
        onElapsed: () => undefined,
      }),
    );

    // Standard big countdown value should be rendered
    expect(html).toMatch(/class="[^"]*countdownValue[^"]*"/);
    expect(html).toContain('调控计时中');

    // Resting fixation cross and instruction must NOT be present
    expect(html).not.toContain('静息态注视中央十字');
    expect(html).not.toContain('请注视中央十字，身心放松，减少眨眼与头动');
    expect(html).not.toMatch(/class="[^"]*restingCountdownCorner[^"]*"/);
  });

  it('reflects completed state when elapsed in natural_recovery mode', () => {
    const state = createEffectEvaluationFlowState();
    state.condition = 'natural_recovery';
    state.durationMinutes = 1;
    // Window started in the past such that it has elapsed
    state.regulationStartedAtMs = Date.now() - 120_000;
    state.regulationStartedAtMonotonicMs = performance.now() - 120_000;

    const html = renderToStaticMarkup(
      createElement(ConditionCountdown, {
        state,
        windowNoun: '自然恢复',
        onElapsed: () => undefined,
      }),
    );

    expect(html).toContain('自然恢复时长已达成');
    expect(html).toContain('已达成');
    expect(html).toContain('请注视中央十字，身心放松，减少眨眼与头动');
  });
});
