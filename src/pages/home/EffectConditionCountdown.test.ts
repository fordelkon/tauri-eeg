import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConditionCountdown } from './EffectConditionCountdown';
import { createEffectEvaluationFlowState } from './effectEvaluationFlow';

describe('condition window display', () => {
  it.each([0, 150_000])('keeps the participant timer silent at %i ms', (elapsed) => {
    const state = {
      ...createEffectEvaluationFlowState(),
      durationMinutes: 1,
      regulationStartedAtMs: Date.now() - elapsed,
      regulationStartedAtMonotonicMs: performance.now() - elapsed,
    };
    const html = renderToStaticMarkup(
      createElement(ConditionCountdown, {
        state,
        windowNoun: '静息',
        onElapsed: () => undefined,
        silent: true,
      }),
    );
    expect(html).toBe('');
  });

  it('keeps the visible timer for the music player', () => {
    const state = {
      ...createEffectEvaluationFlowState(),
      condition: 'regulation' as const,
      durationMinutes: 5,
      regulationStartedAtMs: Date.now(),
      regulationStartedAtMonotonicMs: performance.now(),
    };
    const html = renderToStaticMarkup(
      createElement(ConditionCountdown, {
        state,
        windowNoun: '调控',
        onElapsed: () => undefined,
      }),
    );
    expect(html).toContain('调控计时中');
    expect(html).toContain('调控计时进度');
  });
});
