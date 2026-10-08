import { describe, expect, test, vi } from 'vitest';
import type { EmitEventInput } from '../../src/experiment/api';
import { createEffectEvaluationFlowState, type EffectEvaluationFlowState } from '../../src/pages/home/effectEvaluationFlow';
import { EffectEvaluationExecution, type EffectExecutionDependencies } from '../../src/pages/home/effectEvaluationExecution';
import type { InductionPoolStatus } from '../../src/pages/home/effectInductionPool';

const readyPool: InductionPoolStatus = { kind: 'ready', entry: { videoId: 'clip', fileName: 'clip.mp4', absolutePath: 'C:/materials/clip.mp4' } };
const answers = { stai: {}, panas: {} };

function deferred() {
  let resolve = () => {};
  let reject = (_error: Error) => {};
  const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function fixture(patch: Partial<EffectEvaluationFlowState> = {}) {
  let wall = 100_000;
  let monotonic = 5_000;
  const markers: EmitEventInput[] = [];
  const dependencies = {
    createRun: vi.fn(async () => ({ runId: 'run' })),
    emitEvent: vi.fn(async (input: EmitEventInput) => { markers.push(input); }),
    finishRun: vi.fn(async () => {}),
    linkScale: vi.fn(async () => {}),
    saveScale: vi.fn(async (_state: EffectEvaluationFlowState, phase: 'baseline' | 'post') => ({ id: `${phase}-record` })),
    scaleSaved: vi.fn(), preferences: () => ({ mode: 'rehearsal', externalRecordingConfirmed: false, expectedRecordingName: '' }),
    consumeRecordingConfirmation: vi.fn(), userId: () => 'user', paradigmActive: vi.fn(() => false),
    subjectSelected: vi.fn(), wallNow: () => wall, monotonicNow: () => monotonic,
  } satisfies EffectExecutionDependencies;
  const execution = new EffectEvaluationExecution({ ...createEffectEvaluationFlowState(), subjectId: ' subject ', durationMinutes: 1, ...patch }, dependencies);
  return { execution, dependencies, markers, advance: (ms: number) => { wall += ms; monotonic += ms; }, jumpWall: (ms: number) => { wall += ms; } };
}

describe('effect evaluation execution', () => {
  test('preserves the normal marker and persistence sequence through completion', async () => {
    const { execution, dependencies, markers, advance } = fixture();
    execution.startBaselineMeasurement();
    expect(dependencies.subjectSelected).toHaveBeenCalledWith('subject');
    expect(await execution.beginInduction(readyPool)).toBe(true);
    await execution.inductionOnset('clip');
    expect(await execution.completeInduction()).toBe(true);
    expect(await execution.completeScaleMeasurement('baseline', answers)).toBe(true);
    await execution.beginRegulation();
    advance(60_000);
    await execution.conditionElapsed();
    expect(await execution.finishRegulation()).toBe(true);
    expect(await execution.completeScaleMeasurement('post', answers)).toBe(true);
    expect(markers.map(marker => marker.eventName)).toEqual([
      'anxiety_video_start', 'induction_video_end', 'pre_scale_start', 'pre_scale_submit',
      'natural_recovery_start', 'natural_recovery_end', 'post_scale_start', 'post_scale_submit',
    ]);
    expect(markers[0]).toMatchObject({ runId: 'run', eventId: 'run:induction:anxiety_video_start',
      phaseInstanceId: 'run:induction', mediaId: 'clip', source: 'html_video_playing', frontendMonotonicMs: 5_000 });
    expect(dependencies.linkScale.mock.calls).toEqual([['run', 'baseline-record', 'baseline'], ['run', 'post-record', 'post']]);
    expect(dependencies.finishRun).toHaveBeenCalledExactlyOnceWith('run', 'completed');
    expect(execution.getSnapshot().state).toMatchObject({ step: 5, eventLogStatus: 'saved', baselineRecordId: 'baseline-record', postRecordId: 'post-record', interrupted: false });
  });

  test('duplicate end callbacks share pending acknowledgments before advancing', async () => {
    const { execution, dependencies, markers } = fixture({ step: 1, runId: 'run', eventLogStatus: 'active' });
    const pending = deferred();
    dependencies.emitEvent.mockImplementationOnce(async input => { markers.push(input); await pending.promise; });
    const first = execution.completeInduction();
    const second = execution.completeInduction();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(markers).toHaveLength(1));
    expect(execution.getSnapshot().state.step).toBe(1);
    expect(markers.map(marker => marker.eventName)).toEqual(['induction_video_end']);
    pending.resolve();
    expect(await second).toBe(true);
    expect(markers.map(marker => marker.eventName)).toEqual(['induction_video_end', 'pre_scale_start']);
    expect(await execution.completeInduction()).toBe(false);
  });

  test('duplicate playing callbacks preserve the first clock and finish waits for pending condition end', async () => {
    const { execution, dependencies, markers, advance } = fixture({ step: 3, runId: 'run', condition: 'regulation', method: 'music' });
    const pendingStart = deferred();
    dependencies.emitEvent.mockImplementationOnce(async input => { markers.push(input); await pendingStart.promise; });
    const first = execution.beginRegulation('track', { volume: 0.5 });
    advance(1_000);
    const second = execution.beginRegulation('track');
    await vi.waitFor(() => expect(markers).toHaveLength(1));
    expect(execution.getSnapshot().state.regulationStartedAtMonotonicMs).toBe(5_000);
    pendingStart.resolve();
    await Promise.all([first, second]);
    expect(markers[0]).toMatchObject({ eventName: 'music_regulation_start', source: 'html_audio_playing', frontendMonotonicMs: 5_000, details: { volume: 0.5 } });
    advance(59_000);
    const pendingEnd = deferred();
    dependencies.emitEvent.mockImplementationOnce(async input => { markers.push(input); await pendingEnd.promise; });
    const elapsed = execution.conditionElapsed();
    const finish = execution.finishRegulation();
    await vi.waitFor(() => expect(markers).toHaveLength(2));
    expect(execution.getSnapshot().state.step).toBe(3);
    pendingEnd.resolve();
    await elapsed;
    expect(await finish).toBe(true);
    expect(markers.map(marker => marker.eventName)).toEqual(['music_regulation_start', 'music_regulation_end', 'post_scale_start']);
  });

  test('a marker failure interrupts once and prevents all queued progression and replay', async () => {
    const { execution, dependencies, markers } = fixture({ step: 1, runId: 'run' });
    const pending = deferred();
    dependencies.emitEvent.mockImplementationOnce(async input => { markers.push(input); await pending.promise; });
    const onset = execution.inductionOnset('clip');
    const completion = execution.completeInduction();
    await vi.waitFor(() => expect(markers).toHaveLength(1));
    pending.reject(new Error('device disconnected'));
    await onset;
    expect(await completion).toBe(false);
    expect(execution.getSnapshot().state).toMatchObject({ step: 1, interrupted: true, eventLogStatus: 'interrupted' });
    expect(markers.map(marker => marker.eventName)).toEqual(['anxiety_video_start']);
    expect(dependencies.finishRun).toHaveBeenCalledExactlyOnceWith('run', 'aborted');
    await execution.inductionOnset('clip');
    expect(await execution.completeInduction()).toBe(false);
    expect(markers).toHaveLength(1);
  });

  test('early completion cannot bypass the duration through callbacks or a wall clock jump', async () => {
    const { execution, dependencies, markers, jumpWall } = fixture({ step: 3, runId: 'run' });
    expect(await execution.finishRegulation()).toBe(false);
    await execution.beginRegulation();
    jumpWall(300_000);
    await execution.conditionElapsed();
    expect(await execution.finishRegulation()).toBe(false);
    expect(execution.regulationFinishMode()).toEqual({ mode: 'requires-skip', remainingSeconds: 60 });
    expect(execution.getSnapshot().isWindowElapsed).toBe(false);
    expect(markers.map(marker => marker.eventName)).toEqual(['natural_recovery_start']);
    expect(await execution.skipRemainingRegulation()).toBe(true);
    expect(markers.map(marker => marker.eventName)).toEqual(['natural_recovery_start', 'trial_skip', 'natural_recovery_end', 'post_scale_start']);
    await execution.completeScaleMeasurement('post', answers);
    expect(execution.getSnapshot().state).toMatchObject({ regulationSkipped: true, step: 5 });
    expect(dependencies.finishRun).toHaveBeenCalledExactlyOnceWith('run', 'aborted');
  });

  test('out of phase actions cannot create runs, scales or markers', async () => {
    const { execution, dependencies, markers } = fixture();
    expect(await execution.beginInduction(readyPool)).toBe(false);
    expect(await execution.completeScaleMeasurement('post', answers)).toBe(false);
    await execution.beginRegulation();
    await execution.inductionOnset('clip');
    expect(await execution.completeInduction()).toBe(false);
    expect(dependencies.createRun).not.toHaveBeenCalled();
    expect(dependencies.saveScale).not.toHaveBeenCalled();
    expect(markers).toEqual([]);
  });

  test('scale failure preserves the current phase and interrupts', async () => {
    const { execution, dependencies } = fixture({ step: 2, runId: 'run' });
    dependencies.linkScale.mockRejectedValueOnce(new Error('link failed'));
    expect(await execution.completeScaleMeasurement('baseline', answers)).toBe(false);
    expect(execution.getSnapshot()).toMatchObject({ isSavingScale: false, state: { step: 2, baselineRecordId: null, interrupted: true } });
    expect(dependencies.scaleSaved).not.toHaveBeenCalled();
    expect(dependencies.finishRun).toHaveBeenCalledExactlyOnceWith('run', 'aborted');
  });

  test('reload aborts the old run without replay and reset allows a fresh run', async () => {
    const { dependencies } = fixture();
    const execution = new EffectEvaluationExecution({ ...createEffectEvaluationFlowState(), step: 3, runId: 'old' }, dependencies, true);
    execution.recover();
    execution.recover();
    expect(execution.getSnapshot().state.interrupted).toBe(true);
    expect(dependencies.finishRun).toHaveBeenCalledExactlyOnceWith('old', 'aborted');
    expect(await execution.finishRegulation()).toBe(false);
    expect(await execution.resetFlow()).toBe(true);
    execution.updateDraft({ subjectId: 'new' });
    execution.startBaselineMeasurement();
    expect(await execution.beginInduction(readyPool)).toBe(true);
    expect(execution.getSnapshot().state).toMatchObject({ runId: 'run', step: 1, interrupted: false });
    expect(dependencies.emitEvent).not.toHaveBeenCalled();
  });

  test('reset retains the interrupted run when abort fails and permits a retry', async () => {
    const { execution, dependencies } = fixture({ step: 1, runId: 'run' });
    dependencies.finishRun.mockRejectedValueOnce(new Error('abort unavailable'));
    expect(await execution.resetFlow()).toBe(false);
    expect(execution.getSnapshot().state).toMatchObject({ runId: 'run', step: 1, interrupted: true });
    expect(await execution.resetFlow()).toBe(true);
    expect(execution.getSnapshot().state).toMatchObject({ runId: null, step: 0, interrupted: false });
  });

  test('duplicate scale submissions share one write and reset waits until the operation finishes', async () => {
    const { execution, dependencies } = fixture({ step: 2, runId: 'run' });
    const pending = deferred();
    dependencies.saveScale.mockImplementationOnce(async () => { await pending.promise; return { id: 'baseline-record' }; });
    const first = execution.completeScaleMeasurement('baseline', answers);
    const second = execution.completeScaleMeasurement('baseline', answers);
    expect(second).toBe(first);
    expect(await execution.resetFlow()).toBe(false);
    pending.resolve();
    expect(await first).toBe(true);
    expect(dependencies.saveScale).toHaveBeenCalledTimes(1);
    expect(execution.getSnapshot().state.step).toBe(3);
  });

  test('failure to finish the post measurement does not publish results', async () => {
    const { execution, dependencies } = fixture({ step: 4, runId: 'run' });
    dependencies.finishRun.mockRejectedValueOnce(new Error('finish unavailable'));
    expect(await execution.completeScaleMeasurement('post', answers)).toBe(false);
    expect(execution.getSnapshot().state).toMatchObject({ step: 4, postRecordId: null, interrupted: true });
    expect(dependencies.finishRun.mock.calls).toEqual([['run', 'completed'], ['run', 'aborted']]);
    expect(dependencies.scaleSaved).not.toHaveBeenCalled();
  });

  test('leaving the page while run creation is pending aborts the created run', async () => {
    const { execution, dependencies } = fixture({ step: 1 });
    const pending = deferred();
    dependencies.createRun.mockImplementationOnce(async () => { await pending.promise; return { runId: 'run' }; });
    const start = execution.beginInduction(readyPool);
    await vi.waitFor(() => expect(dependencies.createRun).toHaveBeenCalledTimes(1));
    execution.dispose();
    pending.resolve();
    expect(await start).toBe(false);
    expect(execution.getSnapshot().state).toMatchObject({ interrupted: true, eventLogStatus: 'interrupted' });
    expect(dependencies.finishRun).toHaveBeenCalledExactlyOnceWith('run', 'aborted');
    expect(dependencies.emitEvent).not.toHaveBeenCalled();
  });

  test('unmounting during the final phase marker does not advance the aborted run', async () => {
    const { execution, dependencies, markers } = fixture({ step: 1, runId: 'run' });
    const pending = deferred();
    dependencies.emitEvent.mockImplementation(async input => {
      markers.push(input);
      if (input.eventName === 'pre_scale_start') await pending.promise;
    });
    const completion = execution.completeInduction();
    await vi.waitFor(() => expect(markers).toHaveLength(2));
    execution.dispose();
    pending.resolve();
    expect(await completion).toBe(false);
    expect(execution.getSnapshot().state).toMatchObject({ step: 1, interrupted: true });
    expect(dependencies.finishRun).toHaveBeenCalledExactlyOnceWith('run', 'aborted');
  });

  test('a delayed player callback from a reset run cannot send markers or complete the next run', async () => {
    const { execution, dependencies, markers } = fixture({ step: 1, runId: 'old' });
    const oldPlayer = execution.bindPlayback();
    expect(await execution.resetFlow()).toBe(true);
    execution.updateDraft({ subjectId: 'new' });
    execution.startBaselineMeasurement();
    expect(await execution.beginInduction(readyPool)).toBe(true);
    await oldPlayer.inductionOnset('old-clip');
    await oldPlayer.playbackError();
    expect(await oldPlayer.completeInduction()).toBe(false);
    expect(markers).toEqual([]);
    expect(execution.getSnapshot().state).toMatchObject({ step: 1, runId: 'run', interrupted: false });
    const currentPlayer = execution.bindPlayback();
    await currentPlayer.inductionOnset('clip');
    expect(await currentPlayer.completeInduction()).toBe(true);
    expect(markers.map(marker => marker.mediaId)).toEqual(['clip', undefined, undefined]);
    expect(dependencies.finishRun).toHaveBeenCalledExactlyOnceWith('old', 'aborted');
  });
});
