// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (url: URL) => readFileSync(url, 'utf8');

/**
 * Wiring contracts for the effect-evaluation loop (R2): routing, home
 * navigation, subject passthrough into persistence, and the missing-record
 * guard. Source-contract style matches MusicRegulation.behavior.test.ts so
 * these stay runnable in the plain-node vitest environment.
 */

describe('EffectEvaluation wiring contract', () => {
  test('registers /effect-evaluation outside the standalone regulation gate', () => {
    const appSource = readText(new URL('../../App.tsx', import.meta.url));

    expect(appSource).toContain("import('./pages/home/EffectEvaluation')");
    expect(appSource).toContain('path="/effect-evaluation"');
    // The wizard orchestrates its own baseline/post phases, so it must sit
    // before the ScaleGateRoute block rather than inside it.
    const evaluationIndex = appSource.indexOf('path="/effect-evaluation"');
    const gateIndex = appSource.indexOf('<Route element={<ScaleGateRoute />}>');
    expect(evaluationIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeGreaterThan(evaluationIndex);
  });

  test('adds the effect-evaluation entry to the home navigation', () => {
    const homeSource = readText(new URL('../Home.tsx', import.meta.url));

    expect(homeSource).toContain("{ icon: InsightsRoundedIcon, label: '效果评价', path: '/effect-evaluation' }");
  });

  test('renders the shared gate dialog and confirm dialog on the page', () => {
    const pageSource = readText(new URL('./EffectEvaluation.tsx', import.meta.url));

    expect(pageSource).toContain("import MentalScaleDialog from '../../mentalScale/MentalScaleDialog'");
    expect(pageSource).toContain("import { useConfirmDialog } from '../../ui/useConfirmDialog'");
    expect(pageSource).toContain('<MentalScaleDialog');
    expect(pageSource).toContain('useConfirmDialog()');
  });
});

describe('subject passthrough contract', () => {
  test('saves phase records under the configured subject for both phases', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));

    expect(hookSource).toContain('savePhaseScaleRecord(scale, answers, {');
    expect(hookSource).toContain('subjectId: state.subjectId.trim()');
    expect(hookSource).toContain('phase === \'baseline\'');
  });

  test('shares the validated subject with the rest of the app on setup completion', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));

    expect(hookSource).toContain("import { writeStoredSubjectId } from '../../storage/currentSubject'");
    expect(hookSource).toContain('writeStoredSubjectId(state.subjectId.trim())');
  });

  test('blocks the summary on missing measurements instead of invoking the backend', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));
    const guardIndex = hookSource.indexOf('describeMissingMeasurements(state)');
    const computeIndex = hookSource.indexOf('computeRegulationEffect(baselineRecordId');

    // The guard must short-circuit before any backend call.
    expect(guardIndex).toBeGreaterThan(-1);
    expect(computeIndex).toBeGreaterThan(guardIndex);
    expect(hookSource).toContain('if (missingCopy)');
  });

  test('persists gate submissions with an explicit subject binding option', () => {
    const apiSource = readText(new URL('../../mentalScale/scaleRecordsApi.ts', import.meta.url));

    // R2: records no longer hard-code subjectId null — explicit binding wins,
    // otherwise the shared subject memory is consulted.
    expect(apiSource).toContain('readStoredSubjectId()');
    expect(apiSource).not.toContain('subjectId: null,');
  });
});
