// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (url: URL) => readFileSync(url, 'utf8');

/**
 * Tick-confinement contract (render-cost regression guard).
 *
 * The effect-evaluation page must render only on real state changes — never
 * on the condition window's wall clock. The 500ms poll therefore lives in
 * exactly ONE component: the self-contained `ConditionCountdown` leaf, which
 * ticks its own digits and reports expiry upward as a one-shot fact.
 *
 * The repo's vitest environment is plain node (no DOM / component mounting
 * stack), so these contracts pin the shape at the source level instead of
 * counting renders at runtime. Render-path trace per 500ms tick while the
 * window runs:
 *
 *   leaf interval fires → `setRemainingSeconds(next)`
 *   → identical integer seconds bail out of the update (no render at all),
 *     so the leaf renders at ~1Hz, not at the poll cadence;
 *   → nothing above the leaf re-renders: the page holds no tick state, the
 *     timeline/done band/result cards are memoized on stable props.
 *   At 0: the leaf reports `onElapsed` exactly once → the page flips
 *   `isWindowElapsed` (one dispatch-driven render, unlocking the finish gate
 *   and the player's to-zero pause) and the leaf stops polling. The hook
 *   re-renders its consumers only on real dispatches (e.g. EEG badge flips).
 */

const pageUrl = new URL('./EffectEvaluation.tsx', import.meta.url);
const hookUrl = new URL('./useEffectEvaluationFlow.ts', import.meta.url);
const countdownUrl = new URL('./EffectConditionCountdown.tsx', import.meta.url);
const panelsUrl = new URL('./EffectStepPanels.tsx', import.meta.url);

/** Every file the wizard page can mount (the standalone regulation pages are
 *  NOT part of this tree — `useEffectRegulationContext` polls there by design,
 *  because the wizard route is unmounted during the jump). */
const mountedWizardTreeFiles = [
  './EffectEvaluation.tsx',
  './useEffectEvaluationFlow.ts',
  './EffectStepPanels.tsx',
  './EffectConditionCountdown.tsx',
  './EffectRegulationPlayer.tsx',
  './EffectTimeline.tsx',
  './EffectProgressDisclosure.tsx',
  './EffectReviewPopover.tsx',
  './EffectResultCards.tsx',
  './EffectResultChartView.tsx',
  './EffectDeviceQuickStart.tsx',
] as const;

const TICK_OWNER = './EffectConditionCountdown.tsx';

describe('effect-evaluation tick confinement contract', () => {
  test('exactly one component of the wizard tree owns a wall-clock interval', () => {
    for (const file of mountedWizardTreeFiles) {
      const source = readText(new URL(file, import.meta.url));

      if (file === TICK_OWNER) {
        // The countdown leaf: a 500ms poll…
        expect(source).toContain('window.setInterval');
        expect(source).toContain('}, 500);');
        continue;
      }

      // …nothing else in the mounted tree may poll the wall clock.
      expect(source, `${file} must not own a wall-clock interval`).not.toContain('setInterval');
    }
  });

  test('the hook and the page hold no per-tick clock state', () => {
    const hookSource = readText(hookUrl);
    const pageSource = readText(pageUrl);

    // The pre-optimization design kept `nowMs` state + a 500ms interval in
    // the hook, re-rendering the whole page 2x/s; the contract forbids both.
    expect(hookSource).not.toContain('setInterval');
    expect(hookSource).not.toContain('nowMs');
    expect(pageSource).not.toContain('setInterval');
    expect(pageSource).not.toContain('nowMs');
    // The page/panels must not read a per-tick remaining value off the hook:
    // the gate rides the one-shot `isWindowElapsed` fact instead.
    expect(pageSource).not.toContain('flow.remainingSeconds');
    expect(readText(panelsUrl)).not.toContain('flow.remainingSeconds');
  });

  test('the page consumes only the one-shot expiry fact and relocks it on reset', () => {
    const pageSource = readText(pageUrl);
    const panelsSource = readText(panelsUrl);

    // The leaf reports expiry upward; the page flips the gate exactly once…
    expect(panelsSource).toContain('onElapsed={onWindowElapsed}');
    expect(pageSource).toContain('useCallback(() => setIsWindowElapsed(true), [])');
    // …and a fresh run starts with its finish gate locked again.
    expect(pageSource).toContain('setIsWindowElapsed(false);');
    // The countdown leaf receives the flow state (it reads its own clock
    // from the stamped window start) rather than precomputed digits.
    expect(panelsSource).toContain('<ConditionCountdown');
    expect(panelsSource).toContain('state={state}');
    expect(panelsSource).toContain('windowNoun={windowNoun}');
  });

  test('the countdown leaf polls only while the window runs and cleans up', () => {
    const source = readText(countdownUrl);

    // The interval is gated: once elapsed (or before start) it must not run…
    expect(source).toContain('if (hasElapsed) {');
    expect(source).toContain('return undefined;');
    // …identical integer seconds bail out of the state update…
    expect(source).toContain('setRemainingSeconds(next);');
    // …and the interval is cleaned up on unmount (StrictMode double-mount
    // safe: the effect owns its own interval id).
    expect(source).toContain('return () => window.clearInterval(intervalId);');
    // The expiry report is one-shot per mount.
    expect(source).toContain('onElapsedRef.current();');
  });
});
