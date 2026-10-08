import { beforeEach, describe, expect, it, vi } from 'vitest';
const ipc = vi.hoisted(() => ({ emitEvent: vi.fn(), saveTrial: vi.fn(), finishRun: vi.fn() }));
vi.mock('../../src/experiment/api', () => ipc);
import { ParadigmExecution } from '../../src/paradigm/paradigmExecution';
import type { ParadigmTrialPlanItem } from '../../src/paradigm/types';

const plan: ParadigmTrialPlanItem = {
  trialIndex: 0, emotion: 'calm', triggerClass: 3, videoId: 'calm-1', videoPath: 'C:/videos/calm.mp4',
};
const report = { valence: 7, arousal: 3 };
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const events = () => ipc.emitEvent.mock.calls.map(([input]) => input.eventName);
const token = (run: ParadigmExecution) => run.getSnapshot().state;
async function idle(run: ParadigmExecution) {
  await vi.waitFor(() => expect(run.getSnapshot().operation).toBe('idle'));
}
async function start(queue = [plan]) {
  const run = new ParadigmExecution({ runId: 'run-1', queue, sessionKind: 'personal_calibration' });
  run.start();
  await idle(run);
  return run;
}
async function video(run: ParadigmExecution) {
  run.countdownComplete(token(run));
  run.countdownComplete(token(run));
  await run.videoFirstPlay(token(run));
}
async function review(run: ParadigmExecution) {
  await video(run);
  await run.videoEnded(token(run));
  await run.countdownComplete(token(run));
}

beforeEach(() => {
  vi.clearAllMocks();
  ipc.emitEvent.mockResolvedValue({ result: 'rehearsal' });
  ipc.saveTrial.mockImplementation(async (_id, trial) => trial);
  ipc.finishRun.mockResolvedValue({});
});

describe('independent paradigm execution', () => {
  it('retains marker identities, order, quality, SAM and summary through completion', async () => {
    const run = await start();
    await review(run);
    run.selfReportSubmit(token(run), report);
    await idle(run);
    expect(events()).toEqual([
      'trial_start', 'baseline_rest_start', 'hint_start', 'calm_video_start',
      'induction_video_end', 'post_rest_start', 'trial_end', 'sam_start', 'sam_submit',
    ]);
    expect(ipc.emitEvent.mock.calls.map(([input]) => input.eventId)).toEqual(
      events().map((event) => `run-1:trial:0:${event}`),
    );
    expect(ipc.saveTrial.mock.lastCall?.[1]).toMatchObject({
      presentationStatus: 'completed', quality: 'accepted', selfReport: report, artifactFlags: [],
    });
    expect(run.getSnapshot().summary).toMatchObject({ totalTrials: 1, valenceMean: 7, arousalMean: 3 });
    expect(ipc.finishRun.mock.calls).toEqual([['run-1', 'completed']]);
  });

  it('keeps duration rejection ahead of the SAM acceptance result', async () => {
    const run = await start();
    await video(run);
    run.videoDurationLoaded(token(run), 120);
    await run.videoEnded(token(run));
    await run.countdownComplete(token(run));
    run.selfReportSubmit(token(run), report);
    await idle(run);
    expect(ipc.saveTrial.mock.lastCall?.[1]).toMatchObject({
      quality: 'artifact_rejected', artifactFlags: ['video_duration_out_of_range'], selfReport: report,
    });
  });

  it('starts once under repeated mounting and holds the next emotion block for the operator', async () => {
    const second: ParadigmTrialPlanItem = { ...plan, trialIndex: 1, emotion: 'fear', triggerClass: 5 };
    const run = await start([plan, second]);
    run.start();
    await run.skip(token(run), async () => true);
    await idle(run);
    expect(run.getSnapshot().state).toMatchObject({ phase: 'running', trialPhase: 'interTrial', currentTrialIndex: 0 });
    expect(events().filter((event) => event === 'trial_start')).toHaveLength(1);
    run.setBlockGate(1);
    await idle(run);
    expect(run.getSnapshot().state).toMatchObject({ trialPhase: 'baseline', currentTrialIndex: 1 });
    expect(events().filter((event) => event === 'trial_start')).toHaveLength(2);
  });

  it('auto-starts another trial within the same block and ignores previous trial callbacks', async () => {
    const run = await start([plan, { ...plan, trialIndex: 1 }]);
    await video(run);
    const previous = token(run);
    await run.skip(previous, async () => true);
    await idle(run);
    await video(run);
    const before = events();
    run.videoDurationLoaded(previous, 120);
    await run.videoEnded(previous);
    run.countdownComplete(previous);
    await run.videoError(previous);
    expect(events()).toEqual(before);
    expect(run.getSnapshot().state).toMatchObject({ currentTrialIndex: 1, trialPhase: 'video' });
    await run.videoEnded(token(run));
    await run.countdownComplete(token(run));
    run.selfReportSubmit(token(run), report);
    await idle(run);
    expect(ipc.saveTrial.mock.lastCall?.[1]).toMatchObject({ quality: 'accepted', artifactFlags: [] });
  });

  it('deduplicates media facts and rejects a countdown from an earlier phase', async () => {
    const run = await start();
    const baseline = token(run);
    run.countdownComplete(baseline);
    run.countdownComplete(baseline);
    expect(run.getSnapshot().state.trialPhase).toBe('hint');
    run.countdownComplete(token(run));
    const playing = token(run);
    await Promise.all([run.videoFirstPlay(playing), run.videoFirstPlay(playing)]);
    await Promise.all([run.videoEnded(playing), run.videoEnded(playing)]);
    expect(events().filter((event) => event === 'calm_video_start')).toHaveLength(1);
    expect(events().filter((event) => event === 'induction_video_end')).toHaveLength(1);
    expect(run.getSnapshot().state.trialPhase).toBe('postRest');
  });

  it('rechecks a skip confirmation after the countdown has begun ending the trial', async () => {
    const run = await start();
    await video(run);
    await run.videoEnded(token(run));
    const confirmation = deferred();
    const end = deferred();
    ipc.emitEvent.mockImplementation(async (input) => {
      if (input.eventName === 'trial_end') await end.promise;
    });
    const stage = token(run);
    const skipping = run.skip(stage, async () => { await confirmation.promise; return true; });
    const ending = run.countdownComplete(stage);
    confirmation.resolve();
    await skipping;
    expect(events()).not.toContain('trial_skip');
    end.resolve();
    await ending;
    expect(run.getSnapshot().state.trialPhase).toBe('selfReport');
  });

  it('serializes two confirmed skips and ignores media advancement during skip persistence', async () => {
    const run = await start();
    await video(run);
    const stage = token(run);
    const persistence = deferred();
    ipc.saveTrial.mockImplementation(async (_id, trial) => {
      if (trial.presentationStatus === 'skipped') await persistence.promise;
      return trial;
    });
    const skipping = run.skip(stage, async () => true);
    await vi.waitFor(() => expect(run.getSnapshot().operation).toBe('skip'));
    await run.videoEnded(stage);
    run.countdownComplete(stage);
    await run.skip(stage, async () => true);
    persistence.resolve();
    await skipping;
    await idle(run);
    expect(run.getSnapshot().state.phase).toBe('finished');
    expect(run.getSnapshot().summary?.totalTrials).toBe(1);
    expect(events().filter((event) => event === 'trial_skip')).toHaveLength(1);
    expect(events()).not.toContain('post_rest_start');
  });

  it('aborts a pending begin without starting presentation or leaking baseline markers', async () => {
    const saving = deferred();
    ipc.saveTrial.mockImplementation(async (_id, trial) => {
      if (trial.presentationStatus === 'started') await saving.promise;
      return trial;
    });
    const run = new ParadigmExecution({ runId: 'run-1', queue: [plan], sessionKind: 'personal_calibration' });
    run.start();
    const aborting = run.abort();
    expect(run.getSnapshot().state.phase).toBe('error');
    saving.resolve();
    await aborting;
    expect(events()).toEqual([]);
    expect(ipc.saveTrial.mock.calls.map(([, trial]) => trial.presentationStatus)).toEqual(['started', 'interrupted']);
    expect(ipc.finishRun.mock.calls).toEqual([['run-1', 'aborted', undefined]]);
    expect(run.getSnapshot().state.currentTrialIndex).toBe(-1);
  });

  it('aborts pending finalization before SAM submission and run completion', async () => {
    const run = await start();
    await review(run);
    const saving = deferred();
    ipc.saveTrial.mockImplementation(async (_id, trial) => {
      if (trial.presentationStatus === 'completed') await saving.promise;
      return trial;
    });
    run.selfReportSubmit(token(run), report);
    const aborting = run.abort();
    saving.resolve();
    await aborting;
    expect(events()).not.toContain('sam_submit');
    expect(ipc.saveTrial.mock.lastCall?.[1]).toMatchObject({ presentationStatus: 'interrupted' });
    expect(ipc.finishRun.mock.calls).toEqual([['run-1', 'aborted', undefined]]);
    expect(run.getSnapshot().summary).toBeNull();
    expect(run.getSnapshot().state.phase).toBe('error');
  });

  it('aborts pending end without entering SAM', async () => {
    const run = await start();
    await video(run);
    await run.videoEnded(token(run));
    const marker = deferred();
    ipc.emitEvent.mockImplementation(async (input) => {
      if (input.eventName === 'trial_end') await marker.promise;
    });
    const ending = run.countdownComplete(token(run));
    const aborting = run.abort();
    marker.resolve();
    await ending;
    await aborting;
    expect(events()).not.toContain('sam_start');
    expect(run.getSnapshot().state.phase).toBe('error');
    expect(ipc.saveTrial.mock.lastCall?.[1]).toMatchObject({ presentationStatus: 'interrupted' });
  });

  it('interrupts failed finalization without publishing a record or completion', async () => {
    const run = await start();
    await review(run);
    ipc.saveTrial.mockRejectedValueOnce(new Error('trial persistence failed'));
    run.selfReportSubmit(token(run), report);
    await vi.waitFor(() => expect(ipc.finishRun).toHaveBeenCalledWith('run-1', 'aborted', 'trial persistence failed'));
    expect(run.getSnapshot().state).toMatchObject({ phase: 'error', errorMessage: 'trial persistence failed' });
    expect(run.getSnapshot().summary).toBeNull();
    expect(events()).not.toContain('sam_submit');
    expect(ipc.saveTrial.mock.lastCall?.[1]).toMatchObject({ presentationStatus: 'interrupted' });
  });

  it('still closes an aborted run if interrupted trial persistence fails', async () => {
    const run = await start();
    ipc.saveTrial.mockRejectedValueOnce(new Error('interrupted save failed'));
    await expect(run.abort()).rejects.toThrow('interrupted save failed');
    expect(ipc.finishRun.mock.calls).toEqual([['run-1', 'aborted', undefined]]);
    expect(run.getSnapshot().state.phase).toBe('error');
  });

  it('returns to setup after completion or operator abort', async () => {
    const completed = await start();
    await completed.skip(token(completed), async () => true);
    await idle(completed);
    completed.exitSession();
    expect(completed.getSnapshot().state).toMatchObject({ phase: 'setup', currentTrialIndex: -1 });
    const aborted = await start();
    await aborted.abort();
    aborted.exitSession();
    expect(aborted.getSnapshot().state).toMatchObject({ phase: 'setup', currentTrialIndex: -1 });
  });

  it('deduplicates operator abort while awaiting persistence', async () => {
    const run = await start();
    const saving = deferred();
    ipc.saveTrial.mockImplementation(async () => saving.promise);
    const first = run.abort();
    const second = run.abort();
    expect(first).toBe(second);
    saving.resolve();
    await first;
    expect(ipc.finishRun).toHaveBeenCalledTimes(1);
  });

  it('reports completion failure and closes the run as aborted without publishing a summary', async () => {
    const run = await start();
    ipc.finishRun.mockRejectedValueOnce(new Error('finish persistence failed')).mockResolvedValue({});
    await run.skip(token(run), async () => true);
    await vi.waitFor(() => expect(ipc.finishRun).toHaveBeenCalledTimes(2));
    expect(run.getSnapshot()).toMatchObject({
      summary: null, summaryError: 'finish persistence failed',
      state: { phase: 'error', errorMessage: 'finish persistence failed' },
    });
    expect(ipc.finishRun.mock.calls).toEqual([
      ['run-1', 'completed'], ['run-1', 'aborted', 'finish persistence failed'],
    ]);
  });

  it('interrupts on marker failure and does not repeat the failed event', async () => {
    const run = await start();
    run.countdownComplete(token(run));
    run.countdownComplete(token(run));
    ipc.emitEvent.mockRejectedValueOnce(new Error('port unplugged'));
    const stage = token(run);
    await run.videoFirstPlay(stage);
    await run.videoFirstPlay(stage);
    await vi.waitFor(() => expect(ipc.finishRun).toHaveBeenCalledWith('run-1', 'aborted', 'port unplugged'));
    expect(events().filter((event) => event === 'calm_video_start')).toHaveLength(1);
    expect(ipc.saveTrial.mock.lastCall?.[1]).toMatchObject({ presentationStatus: 'interrupted', reason: 'port unplugged' });
    expect(run.getSnapshot().state.phase).toBe('error');
  });
});
