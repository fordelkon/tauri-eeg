import { beforeEach, describe, expect, it, vi } from 'vitest';
const ipc = vi.hoisted(() => ({ emitEvent: vi.fn(), saveTrial: vi.fn() }));
vi.mock('../experiment/api', () => ipc);
import { ParadigmExperiment } from './paradigmExperiment';

const plan = {
  trialIndex: 0,
  emotion: 'calm',
  triggerClass: 3,
  videoId: 'calm-1',
  videoPath: 'C:/videos/calm.mp4',
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  ipc.emitEvent.mockResolvedValue({ result: 'rehearsal' });
  ipc.saveTrial.mockImplementation(async (_id, trial) => trial);
});

describe('independent trial recording', () => {
  it('records stimulus boundaries and SAM', async () => {
    const run = new ParadigmExperiment('run-1');
    await run.begin(plan);
    await run.event('hint_start');
    await run.event('calm_video_start', 'html_video_playing');
    await run.event('calm_video_start', 'html_video_playing');
    await run.event('induction_video_end');
    await run.event('post_rest_start');
    await run.end();
    await run.finalize({ valence: 7, arousal: 3 }, 'accepted', []);
    expect(ipc.emitEvent.mock.calls.map(([input]) => input.eventName)).toEqual([
      'trial_start',
      'baseline_rest_start',
      'hint_start',
      'calm_video_start',
      'induction_video_end',
      'post_rest_start',
      'trial_end',
      'sam_start',
      'sam_submit',
    ]);
    expect(
      ipc.emitEvent.mock.calls.map(([input]) => [input.eventName, input.phaseInstanceId]),
    ).toEqual([
      ['trial_start', 'run-1:trial:0:trial'],
      ['baseline_rest_start', 'run-1:trial:0:baseline_rest_start'],
      ['hint_start', 'run-1:trial:0:hint_start'],
      ['calm_video_start', 'run-1:trial:0:induction'],
      ['induction_video_end', 'run-1:trial:0:induction'],
      ['post_rest_start', 'run-1:trial:0:post_rest_start'],
      ['trial_end', 'run-1:trial:0:trial'],
      ['sam_start', 'run-1:trial:0:sam'],
      ['sam_submit', 'run-1:trial:0:sam'],
    ]);
    expect(ipc.saveTrial.mock.lastCall?.[1]).toMatchObject({
      trialId: 'run-1:trial:0',
      presentationStatus: 'completed',
      selfReport: { valence: 7, arousal: 3 },
      quality: 'accepted',
    });
    expect(run.summary()).toMatchObject({
      sessionId: 'run-1',
      totalTrials: 1,
      valenceMean: 7,
      arousalMean: 3,
    });
  });

  it('never resends a failed onset and does not fabricate received hardware triggers', async () => {
    const run = new ParadigmExperiment('run-2');
    await run.begin(plan);
    ipc.emitEvent.mockRejectedValueOnce(new Error('port unplugged'));
    await expect(run.event('calm_video_start')).rejects.toThrow('port unplugged');
    await expect(run.event('calm_video_start')).rejects.toThrow('port unplugged');
    expect(
      ipc.emitEvent.mock.calls.filter(([input]) => input.eventName === 'calm_video_start'),
    ).toHaveLength(1);
  });

  it('persists an interrupted active trial without inventing SAM', async () => {
    const run = new ParadigmExperiment('run-3');
    await run.begin(plan);
    await run.interrupt('串口拔出');
    expect(ipc.saveTrial.mock.lastCall?.[1]).toMatchObject({
      trialId: 'run-3:trial:0',
      presentationStatus: 'interrupted',
      reason: '串口拔出',
    });
    expect(ipc.saveTrial.mock.lastCall?.[1]).not.toHaveProperty('selfReport');
    expect(run.summary()).toMatchObject({ totalTrials: 0, valenceMean: null, arousalMean: null });
  });

  it('records a skipped trial with the established markers and rejection label', async () => {
    const run = new ParadigmExperiment('skip-run');
    await run.begin(plan);
    await run.event('playback_error', 'video_error');
    await run.event('trial_skip');
    await run.event('trial_end');
    await run.finalize(null, 'rejected', ['video_playback_failure']);
    expect(ipc.emitEvent.mock.calls.map(([input]) => input.eventName)).toEqual([
      'trial_start',
      'baseline_rest_start',
      'playback_error',
      'trial_skip',
      'trial_end',
    ]);
    expect(ipc.saveTrial.mock.lastCall?.[1]).toMatchObject({
      presentationStatus: 'skipped',
      quality: 'rejected',
      selfReport: null,
      artifactFlags: ['video_playback_failure'],
      labelSource: 'induction_target',
    });
    expect(run.summary().totalTrials).toBe(1);
  });
});
