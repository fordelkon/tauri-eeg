import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shouldRenderEegFrame } from './eegRenderClock';
import { useEegSession } from './EegSessionContext';
import { createInitialEegSnapshot } from './eegSessionStore';
import type { EegDisplaySnapshot } from './types';

export function useRealtimeEeg() {
  const eegSession = useEegSession();
  const [snapshot, setSnapshot] = useState<EegDisplaySnapshot>(() => eegSession.takeSnapshot());
  const takeSnapshotRef = useRef(eegSession.takeSnapshot);
  const getLatestSequenceRef = useRef(eegSession.getLatestSequence);

  useEffect(() => {
    takeSnapshotRef.current = eegSession.takeSnapshot;
    getLatestSequenceRef.current = eegSession.getLatestSequence;
    setSnapshot(eegSession.takeSnapshot());
  }, [eegSession.takeSnapshot, eegSession.getLatestSequence]);

  // Skip snapshot work while no samples are flowing; the last rendered
  // snapshot stays on screen.
  const streamingRef = useRef(eegSession.deviceStatus === 'streaming');
  // NaN sentinel: sequence numbers restart on every device run, so "no new
  // data" must compare unequal even against a null sequence.
  const lastRenderedSequenceRef = useRef<number | null>(Number.NaN);

  useEffect(() => {
    const streaming = eegSession.deviceStatus === 'streaming';
    streamingRef.current = streaming;
    if (!streaming) {
      lastRenderedSequenceRef.current = Number.NaN;
    }
  }, [eegSession.deviceStatus]);

  useEffect(() => {
    let frame = 0;
    let lastRenderedAtMs: number | null = null;
    let running = !document.hidden;

    const tick = (nowMs: number) => {
      if (streamingRef.current && shouldRenderEegFrame(nowMs, lastRenderedAtMs)) {
        // Blocks arrive at ~20 Hz while frames render at ~30 Hz: probe the
        // sequence first so frames without new data skip the snapshot copy
        // and the React update entirely.
        const latestSequence = getLatestSequenceRef.current();
        if (latestSequence !== lastRenderedSequenceRef.current) {
          lastRenderedSequenceRef.current = latestSequence;
          lastRenderedAtMs = nowMs;
          setSnapshot(takeSnapshotRef.current());
        }
      }

      frame = window.requestAnimationFrame(tick);
    };

    const start = () => {
      if (running) return;
      running = true;
      lastRenderedAtMs = null;
      frame = window.requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      window.cancelAnimationFrame(frame);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };

    if (running) {
      frame = window.requestAnimationFrame(tick);
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const reset = useCallback(() => {
    eegSession.resetBuffer();
    setSnapshot(createInitialEegSnapshot());
  }, [eegSession]);

  return useMemo(() => ({
    canPauseRecord: eegSession.canPauseRecord,
    canResumeRecord: eegSession.canResumeRecord,
    canStartDevice: eegSession.canStartDevice,
    canStartRecord: eegSession.canStartRecord,
    canStopDevice: eegSession.canStopDevice,
    canStopRecord: eegSession.canStopRecord,
    channels: eegSession.channels,
    deviceStatus: eegSession.deviceStatus,
    errorMessage: eegSession.errorMessage,
    pauseRecord: eegSession.pauseRecord,
    recordStatus: eegSession.recordStatus,
    reportPlotWidthPx: eegSession.reportPlotWidthPx,
    reset,
    resumeRecord: eegSession.resumeRecord,
    sampleRateHz: eegSession.sampleRateHz,
    settings: eegSession.settings,
    snapshot,
    setAmplitudeUvPerDiv: eegSession.setAmplitudeUvPerDiv,
    setTimeWindowSeconds: eegSession.setTimeWindowSeconds,
    startDevice: eegSession.startDevice,
    startRecord: eegSession.startRecord,
    stopDevice: eegSession.stopDevice,
    stopRecord: eegSession.stopRecord,
    toggleChannel: eegSession.toggleChannel,
  }), [eegSession, reset, snapshot]);
}
