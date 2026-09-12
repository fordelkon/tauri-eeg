// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (url: URL) => readFileSync(url, 'utf8');

/**
 * Round-7 contract for the collapsible progress disclosure
 * (EffectProgressDisclosure.tsx): the six-station timeline collapses into
 * one light pill row, blooms on step changes, and yields to the scale
 * dialog. Source-contract style matches EffectEvaluation.wiring.test.ts so
 * these stay runnable in the plain-node vitest environment.
 */

const pageUrl = new URL('./EffectEvaluation.tsx', import.meta.url);
const disclosureUrl = new URL('./EffectProgressDisclosure.tsx', import.meta.url);
const cssUrl = new URL('./EffectEvaluation.module.css', import.meta.url);

describe('progress disclosure contract (round 7)', () => {
  test('the disclosure defaults to collapsed and exposes one keyboard-reachable toggle', () => {
    const source = readText(disclosureUrl);

    // Collapsed by default: no announcement on first mount (including a
    // resumed run), the panel only opens on demand or on a step change.
    expect(source).toContain('useState(false)');
    expect(source).toContain('hasRenderedStepRef');

    // The toggle is a real button carrying the disclosure semantics:
    // aria-expanded + aria-controls point at the panel id.
    expect(source).toContain('type="button"');
    expect(source).toContain('aria-expanded={isOpen}');
    expect(source).toContain('aria-controls="effect-progress-panel"');
    expect(source).toContain('id="effect-progress-panel"');
    // onClick (not hover) drives the toggle, so pointer and keyboard paths
    // are the same code.
    expect(source).toContain('onClick={handleToggle}');
  });

  test('the collapsed pill summarizes 步骤 X / 6 · 当前站 with mini progress dots', () => {
    const source = readText(disclosureUrl);

    // The summary mirrors the stage kicker's numbers (one source of truth:
    // EFFECT_FLOW_STEP_COUNT) plus the current station's one-word label.
    expect(source).toContain('步骤 {step + 1} / {EFFECT_FLOW_STEP_COUNT}');
    expect(source).toContain('currentNode.shortLabel');
    // Mini dots carry done/current/pending so the collapsed row alone
    // still shows where the walk is (aria-hidden: the summary says it).
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain('progressDotDone');
    expect(source).toContain('progressDotCurrent');
    expect(source).toContain('progressDotPending');
    expect(source).toContain("status === 'current'");
  });

  test('the expanded panel hosts the timeline and done band with handlers passed through', () => {
    const source = readText(disclosureUrl);

    // The panel renders both existing components untouched; station/chip
    // clicks keep their page-routed review/scroll semantics.
    expect(source).toContain('<EffectTimeline nodes={nodes} onStationClick={onStationClick} />');
    expect(source).toContain('<EffectDoneBand doneNodes={doneNodes} onChipClick={onChipClick} />');
    // The panel is conditional on the same isOpen the toggle drives.
    expect(source).toMatch(/isOpen \?\s*\(\s*<div id="effect-progress-panel"/);
  });

  test('step changes announce then self-collapse, and a manual open pins the panel', () => {
    const source = readText(disclosureUrl);

    // One-shot announce timer: blooms on a step transition, folds after
    // ~2s, cleaned up on unmount/re-run (no dangling timer can fight the
    // operator's toggle).
    expect(source).toContain('ANNOUNCE_MS = 2200');
    expect(source).toContain('window.setTimeout');
    expect(source).toContain('window.clearTimeout');
    expect(source).toMatch(/useEffect\(\(\) => clearAnnounceTimer, \[clearAnnounceTimer\]\);/);
    // A manual open pins the panel across step changes; the announce effect
    // reads the pin through a ref (a pin flip must not re-fire it).
    expect(source).toContain('isPinnedRef');
    expect(source).toContain('isPinnedRef.current = !open;');
    expect(source).toContain('scaleDialogOpenRef.current || isPinnedRef.current');
  });

  test('the scale dialog force-collapses the disclosure and drops any pin', () => {
    const source = readText(disclosureUrl);

    // The instrument owns the viewport (sticky header + focus trap): the
    // panel closes unconditionally and stays closed after the dialog ends.
    expect(source).toContain('if (scaleDialogOpen) {');
    expect(source).toContain('isPinnedRef.current = false;');
    expect(source).toContain('setIsOpen(false);');
  });

  test('the disclosure is memoized and keeps the tick-confinement discipline', () => {
    const source = readText(disclosureUrl);

    // Same bailout contract as the timeline/done band it hosts.
    expect(source).toMatch(/export const EffectProgressDisclosure = memo\(function EffectProgressDisclosure/);
    // The announce timer is a one-shot setTimeout — never a wall-clock poll.
    expect(source).not.toContain('setInterval');
  });

  test('the styles keep the calm-ink recipes and the 40px touch floor', () => {
    const css = readText(cssUrl);

    // Collapsed pill: hairline border + quiet ink, coral only on the
    // current dot; the toggle hits the 40px guideline on every viewport.
    expect(css).toMatch(/\.progressToggle\s*{[^}]*min-height: 40px;/s);
    expect(css).toMatch(/\.progressToggle\s*{[^}]*border: 1px solid var\(--ee-line\);/s);
    expect(css).toMatch(/\.progressDotCurrent\s*{[^}]*border: 2px solid var\(--ee-warm\);/s);
    // Focus ring matches the station/doneChip recipe.
    expect(css).toMatch(/\.progressToggle:focus-visible\s*{[^}]*outline: 2px solid/s);
    // The announce pulse is suppressed under prefers-reduced-motion along
    // with the chevron rotation transition.
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*\.progressDotCurrent,/);
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*\.progressChevron,/);
  });

  test('the page wires disclosure props from the existing pipeline/flow state', () => {
    const pageSource = readText(pageUrl);

    // No new state sources: nodes/doneNodes come from the memoized pipeline
    // hook, handlers are the same station/chip callbacks, and the dialog
    // open flag is the page-owned one the scale panel already consumes.
    expect(pageSource).toContain('nodes={pipelineNodes} doneNodes={doneNodes}');
    expect(pageSource).toContain('onStationClick={handleStationClick} onChipClick={openReview}');
    expect(pageSource).toContain('scaleDialogOpen={isScaleDialogOpen} step={state.step}');
  });
});
