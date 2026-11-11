import { useCallback, useEffect, useRef } from 'react';

export type VideoOnsetSource = 'video_frame' | 'playing_fallback';

/** Onset mark for the first presented video frame (docs/biosemi-trigger-implementation.md §7.1). */
export type VideoOnsetInfo = {
  source: VideoOnsetSource;
  /**
   * Milliseconds from the `playing` event to the detected frame; null when no
   * frame could be observed and the onset is the `playing` fallback itself.
   */
  deltaMs: number | null;
};

/** Fallback delay before treating `playing` itself as the onset when no frame arrives. */
export const VIDEO_ONSET_FRAME_TIMEOUT_MS = 500;

/** Event `source` annotation for a video onset; the frame observation upgrades the legacy mark. */
export function videoOnsetEventSource(onset?: VideoOnsetInfo): string {
  return onset?.source === 'video_frame' ? 'html_video_frame' : 'html_video_playing';
}

type ScheduleTimeout = (handler: () => void, ms: number) => () => void;

const scheduleWindowTimeout: ScheduleTimeout = (handler, ms) => {
  const id = window.setTimeout(handler, ms);
  return () => window.clearTimeout(id);
};

// requestVideoFrameCallback is not yet in the TypeScript DOM lib; keep the
// signature local so the fallback path stays fully typed.
type FrameCallbackCapableVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Arms the one-shot onset mark for a video that has just raised `playing`.
 * With `requestVideoFrameCallback` available the mark fires on the first
 * compositor-presented frame; if no frame arrives within `timeoutMs`, or the
 * API is missing, it degrades to the annotated `playing` fallback. The mark
 * fires exactly once. Returns a disposer cancelling the pending frame
 * callback and timer.
 */
export function armFirstVideoFrameOnset(
  video: HTMLVideoElement,
  fire: (onset: VideoOnsetInfo) => void,
  timeoutMs = VIDEO_ONSET_FRAME_TIMEOUT_MS,
  scheduleTimeout: ScheduleTimeout = scheduleWindowTimeout,
): () => void {
  const frameCapable = video as FrameCallbackCapableVideo;
  const playingAt = performance.now();
  let fired = false;
  let cancelTimeout: (() => void) | null = null;
  const emit = (onset: VideoOnsetInfo) => {
    if (fired) return;
    fired = true;
    cancelTimeout?.();
    fire(onset);
  };
  if (typeof frameCapable.requestVideoFrameCallback !== 'function') {
    emit({ source: 'playing_fallback', deltaMs: null });
    return () => {};
  }
  const handle = frameCapable.requestVideoFrameCallback((now) => {
    emit({
      source: 'video_frame',
      deltaMs: Math.max(0, Math.round(now - playingAt)),
    });
  });
  cancelTimeout = scheduleTimeout(() => emit({ source: 'playing_fallback', deltaMs: null }), timeoutMs);
  return () => {
    cancelTimeout?.();
    frameCapable.cancelVideoFrameCallback?.(handle);
  };
}

/**
 * One-shot `playing` handler shared by the fullscreen players and the trial
 * video stage. Call it with the video element inside the media element's
 * `onPlaying`; it arms the frame onset once and fires the callback at most
 * once per mount, cancelling pending frame callbacks on unmount.
 * Latest-callback semantics keep parent re-renders harmless.
 */
export function useFirstVideoFrameOnset(onOnset: (onset: VideoOnsetInfo) => void) {
  const onsetRef = useRef(onOnset);
  useEffect(() => {
    onsetRef.current = onOnset;
  });
  const armedRef = useRef(false);
  const firedRef = useRef(false);
  const disposeRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      disposeRef.current?.();
    },
    [],
  );
  return useCallback((video: HTMLVideoElement | null) => {
    if (armedRef.current || firedRef.current || !video) return;
    armedRef.current = true;
    disposeRef.current = armFirstVideoFrameOnset(video, (onset) => {
      if (firedRef.current) return;
      firedRef.current = true;
      onsetRef.current(onset);
    });
  }, []);
}
