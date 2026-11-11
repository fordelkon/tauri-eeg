import { describe, expect, test } from 'vitest';
import {
  armFirstVideoFrameOnset,
  VIDEO_ONSET_FRAME_TIMEOUT_MS,
  videoOnsetEventSource,
  type VideoOnsetInfo,
} from './videoFrameOnset';

type FrameObserver = {
  presentFrame: (now: number) => void;
  isCancelled: () => boolean;
};

function videoWithFrameObserver(): HTMLVideoElement & FrameObserver {
  let callback: ((now: number) => void) | null = null;
  let cancelled = false;
  return {
    requestVideoFrameCallback: (cb: (now: number) => void) => {
      callback = cb;
      return 1;
    },
    cancelVideoFrameCallback: () => {
      cancelled = true;
    },
    presentFrame: (now: number) => {
      if (!cancelled) callback?.(now);
    },
    isCancelled: () => cancelled,
  } as unknown as HTMLVideoElement & FrameObserver;
}

type ScheduledTimeout = { handler: () => void; ms: number; cancelled: boolean };

function fakeScheduler() {
  const scheduled: ScheduledTimeout[] = [];
  const scheduleTimeout = (handler: () => void, ms: number) => {
    const entry: ScheduledTimeout = { handler, ms, cancelled: false };
    scheduled.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  return { scheduled, scheduleTimeout };
}

const collectOnsets = () => {
  const onsets: VideoOnsetInfo[] = [];
  return { onsets, fire: (onset: VideoOnsetInfo) => onsets.push(onset) };
};

describe('armFirstVideoFrameOnset', () => {
  test('fires once at the presented frame with the playing→frame delta', () => {
    const video = videoWithFrameObserver();
    const { onsets, fire } = collectOnsets();
    const { scheduled, scheduleTimeout } = fakeScheduler();
    armFirstVideoFrameOnset(video, fire, 500, scheduleTimeout);
    video.presentFrame(performance.now() + 40);
    expect(onsets).toHaveLength(1);
    expect(onsets[0].source).toBe('video_frame');
    expect(onsets[0].deltaMs).toBeGreaterThanOrEqual(39);
    expect(onsets[0].deltaMs).toBeLessThanOrEqual(45);
    // A second frame, the fallback timer firing late, or another `playing`
    // must not produce a second onset mark.
    video.presentFrame(performance.now());
    scheduled[0].handler();
    expect(onsets).toHaveLength(1);
  });

  test('degrades to the annotated playing fallback when no frame arrives in time', () => {
    const video = videoWithFrameObserver();
    const { onsets, fire } = collectOnsets();
    const { scheduled, scheduleTimeout } = fakeScheduler();
    armFirstVideoFrameOnset(video, fire, 500, scheduleTimeout);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBe(VIDEO_ONSET_FRAME_TIMEOUT_MS);
    scheduled[0].handler();
    expect(onsets).toEqual([{ source: 'playing_fallback', deltaMs: null }]);
    // A frame presented after the fallback must not overwrite the mark.
    video.presentFrame(performance.now());
    expect(onsets).toHaveLength(1);
  });

  test('fires the fallback immediately when requestVideoFrameCallback is missing', () => {
    const { onsets, fire } = collectOnsets();
    const { scheduled, scheduleTimeout } = fakeScheduler();
    const video = {} as HTMLVideoElement;
    armFirstVideoFrameOnset(video, fire, 500, scheduleTimeout);
    expect(onsets).toEqual([{ source: 'playing_fallback', deltaMs: null }]);
    expect(scheduled).toHaveLength(0);
  });

  test('the disposer cancels the pending frame callback and the fallback timer', () => {
    const video = videoWithFrameObserver();
    const { onsets, fire } = collectOnsets();
    const { scheduled, scheduleTimeout } = fakeScheduler();
    const dispose = armFirstVideoFrameOnset(video, fire, 500, scheduleTimeout);
    dispose();
    expect(video.isCancelled()).toBe(true);
    expect(scheduled[0].cancelled).toBe(true);
    // A frame presented after disposal must not produce an onset; the
    // cancelled timer's handler is likewise never invoked by the runtime.
    video.presentFrame(performance.now());
    expect(onsets).toHaveLength(0);
  });

  test('clamps a frame timestamp that predates the playing mark to a zero delta', () => {
    const video = videoWithFrameObserver();
    const { onsets, fire } = collectOnsets();
    armFirstVideoFrameOnset(video, fire, 500, () => () => {});
    video.presentFrame(0);
    expect(onsets[0]).toEqual({ source: 'video_frame', deltaMs: 0 });
  });
});

describe('videoOnsetEventSource', () => {
  test('maps the onset observation to the event source annotation', () => {
    expect(videoOnsetEventSource(undefined)).toBe('html_video_playing');
    expect(videoOnsetEventSource({ source: 'playing_fallback', deltaMs: null })).toBe(
      'html_video_playing',
    );
    expect(videoOnsetEventSource({ source: 'video_frame', deltaMs: 12 })).toBe('html_video_frame');
  });
});
