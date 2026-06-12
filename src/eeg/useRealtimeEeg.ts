import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shouldRenderEegFrame } from './eegRenderClock';
import { useEegSession } from './EegSessionContext';
import { createInitialEegSnapshot } from './eegSessionStore';
import type { EegDisplaySnapshot } from './types';

export function useRealtimeEeg() {
  const eegSession = useEegSession();
  const [snapshot, setSnapshot] = useState<EegDisplaySnapshot>(() => eegSession.takeSnapshot());
  const takeSnapshotRef = useRef(eegSession.takeSnapshot);

  useEffect(() => {
    takeSnapshotRef.current = eegSession.takeSnapshot;
    setSnapshot(eegSession.takeSnapshot());
  }, [eegSession.takeSnapshot]);

  useEffect(() => {
    let frame = 0;
    let lastRenderedAtMs: number | null = null;

    const tick = (nowMs: number) => {
      if (shouldRenderEegFrame(nowMs, lastRenderedAtMs)) {
        lastRenderedAtMs = nowMs;
        setSnapshot(takeSnapshotRef.current());
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frame);
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
