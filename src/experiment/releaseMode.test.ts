import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('formal acquisition build', () => {
  beforeEach(() => {
    vi.stubGlobal('__EXPERIMENT_DEV__', false);
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('drops recording confirmation from a rehearsal preference', async () => {
    const { parseExperimentPreferences, writeExperimentPreferences } = await import('./settings');
    const old = {
      mode: 'rehearsal' as const,
      externalRecordingConfirmed: true,
      expectedRecordingName: 'test.bdf',
      recordingPlanKey: 'test',
    };
    const clean = { mode: 'formal', externalRecordingConfirmed: false, expectedRecordingName: '' };
    for (const raw of [null, 'invalid', JSON.stringify(old)]) {
      expect(parseExperimentPreferences(raw)).toEqual(clean);
    }
    const setItem = vi.fn();
    vi.stubGlobal('window', { sessionStorage: { setItem } });
    expect(writeExperimentPreferences(old)).toEqual(clean);
    expect(JSON.parse(setItem.mock.calls[0][1])).toEqual(clean);
  });

  it('restores only formal wizard states and rejects a rehearsal start', async () => {
    const { createEffectEvaluationFlowState, parseFlowState } =
      await import('../pages/home/effectEvaluationFlow/state');
    const { createRun } = await import('./api');
    const initial = createEffectEvaluationFlowState();
    expect(initial.runMode).toBe('formal');
    expect(parseFlowState(JSON.stringify(initial))).toEqual(initial);
    expect(
      parseFlowState(JSON.stringify({ ...initial, runMode: 'rehearsal', runId: 'practice' })),
    ).toBeNull();
    await expect(
      createRun({
        flowKind: 'effect_evaluation',
        userId: 'operator',
        subjectId: 'subject',
        mode: 'rehearsal',
        externalRecordingConfirmed: false,
      }),
    ).rejects.toThrow('正式实验');
  });

  it('requires a tested trigger and recording even if the caller requests rehearsal', async () => {
    const { getPreparationReadiness } = await import('./preparation');
    const result = getPreparationReadiness({
      mode: 'rehearsal',
      desktop: true,
      libraryValidated: true,
      activeRunId: null,
      connected: false,
      triggerTested: false,
      externalRecordingConfirmed: false,
    });
    expect(result.canEnter).toBe(false);
    expect(result.blockers).toHaveLength(3);
  });
});
