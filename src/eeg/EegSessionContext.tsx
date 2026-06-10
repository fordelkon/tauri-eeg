import {
  createContext,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
  useEffect,
} from 'react';
import { DEFAULT_EEG_CHANNELS } from './channels';
import { EegRingBuffer } from './eegRingBuffer';
import { listenToEegSampleBlocks, startEegStream } from './eegApi';
import {
  canPauseRecord,
  canResumeRecord,
  canStartDevice,
  canStartRecord,
  canStopRecord,
  eegSessionReducer,
  initialEegSessionState,
} from './eegSessionState';
import {
  DEFAULT_SAMPLE_RATE_HZ,
  createInitialEegDisplaySettings,
} from './eegSessionStore';
import type {
  EegDisplaySettings,
  EegDisplaySnapshot,
  EegStreamInfo,
} from './types';

type EegSessionContextValue = {
  bufferRef: MutableRefObject<EegRingBuffer>;
  canPauseRecord: boolean;
  canResumeRecord: boolean;
  canStartDevice: boolean;
  canStartRecord: boolean;
  canStopRecord: boolean;
  channels: typeof DEFAULT_EEG_CHANNELS;
  deviceStatus: typeof initialEegSessionState.deviceStatus;
  errorMessage: string | null;
  pauseRecord: () => void;
  recordStatus: typeof initialEegSessionState.recordStatus;
  resetBuffer: () => void;
  resumeRecord: () => void;
  sampleRateHz: number;
  settings: EegDisplaySettings;
  setAmplitudeUvPerDiv: (amplitudeUvPerDiv: number) => void;
  setTimeWindowSeconds: (timeWindowSeconds: number) => void;
  startDevice: () => Promise<void>;
  startRecord: () => void;
  stopRecord: () => void;
  takeSnapshot: () => EegDisplaySnapshot;
  toggleChannel: (channelId: string) => void;
};

const EegSessionContext = createContext<EegSessionContextValue | null>(null);

export function EegProvider({ children }: { children: ReactNode }) {
  const channels = DEFAULT_EEG_CHANNELS;
  const bufferRef = useRef(new EegRingBuffer(channels, DEFAULT_SAMPLE_RATE_HZ));

  const [streamInfo, setStreamInfo] = useState<EegStreamInfo | null>(null);
  const [sessionState, dispatchSession] = useReducer(eegSessionReducer, initialEegSessionState);
  const [settings, setSettings] = useState<EegDisplaySettings>(createInitialEegDisplaySettings);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    listenToEegSampleBlocks((payload) => {
      bufferRef.current.appendPayload(payload);
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }

        unlisten = nextUnlisten;
      })
      .catch((error) => {
        dispatchSession({
          type: 'start_device_failed',
          message: typeof error === 'string' ? error : 'Failed to subscribe to EEG stream.',
        });
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const startDevice = useCallback(async () => {
    if (!canStartDevice(sessionState)) {
      return;
    }

    dispatchSession({ type: 'start_device_requested' });

    try {
      const info = await startEegStream();
      setStreamInfo(info);
      dispatchSession({ type: 'start_device_succeeded' });
    } catch (error) {
      dispatchSession({
        type: 'start_device_failed',
        message: typeof error === 'string' ? error : 'Failed to start EEG stream.',
      });
    }
  }, [sessionState]);

  const startRecord = useCallback(() => {
    if (canStartRecord(sessionState)) {
      dispatchSession({ type: 'start_record' });
    }
  }, [sessionState]);

  const pauseRecord = useCallback(() => {
    if (canPauseRecord(sessionState)) {
      dispatchSession({ type: 'pause_record' });
    }
  }, [sessionState]);

  const resumeRecord = useCallback(() => {
    if (canResumeRecord(sessionState)) {
      dispatchSession({ type: 'resume_record' });
    }
  }, [sessionState]);

  const stopRecord = useCallback(() => {
    if (canStopRecord(sessionState)) {
      dispatchSession({ type: 'stop_record' });
    }
  }, [sessionState]);

  const resetBuffer = useCallback(() => {
    bufferRef.current.reset();
  }, []);

  const setTimeWindowSeconds = useCallback((timeWindowSeconds: number) => {
    setSettings((current) => ({ ...current, timeWindowSeconds }));
  }, []);

  const setAmplitudeUvPerDiv = useCallback((amplitudeUvPerDiv: number) => {
    setSettings((current) => ({ ...current, amplitudeUvPerDiv }));
  }, []);

  const toggleChannel = useCallback((channelId: string) => {
    setSettings((current) => {
      const visibleChannelIds = new Set(current.visibleChannelIds);

      if (visibleChannelIds.has(channelId)) {
        if (visibleChannelIds.size > 1) {
          visibleChannelIds.delete(channelId);
        }
      } else {
        visibleChannelIds.add(channelId);
      }

      return { ...current, visibleChannelIds };
    });
  }, []);

  const takeSnapshot = useCallback(() => (
    bufferRef.current.toDisplayData(
      settings.visibleChannelIds,
      settings.timeWindowSeconds,
    )
  ), [settings.timeWindowSeconds, settings.visibleChannelIds]);

  const value = useMemo<EegSessionContextValue>(() => ({
    bufferRef,
    canPauseRecord: canPauseRecord(sessionState),
    canResumeRecord: canResumeRecord(sessionState),
    canStartDevice: canStartDevice(sessionState),
    canStartRecord: canStartRecord(sessionState),
    canStopRecord: canStopRecord(sessionState),
    channels,
    deviceStatus: sessionState.deviceStatus,
    errorMessage: sessionState.errorMessage,
    pauseRecord,
    recordStatus: sessionState.recordStatus,
    resetBuffer,
    resumeRecord,
    sampleRateHz: streamInfo?.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ,
    settings,
    setAmplitudeUvPerDiv,
    setTimeWindowSeconds,
    startDevice,
    startRecord,
    stopRecord,
    takeSnapshot,
    toggleChannel,
  }), [
    channels,
    pauseRecord,
    resetBuffer,
    resumeRecord,
    sessionState,
    settings,
    setAmplitudeUvPerDiv,
    setTimeWindowSeconds,
    startDevice,
    startRecord,
    stopRecord,
    streamInfo?.sampleRateHz,
    takeSnapshot,
    toggleChannel,
  ]);

  return (
    <EegSessionContext.Provider value={value}>
      {children}
    </EegSessionContext.Provider>
  );
}

export function useEegSession() {
  const value = useContext(EegSessionContext);

  if (!value) {
    throw new Error('useEegSession must be used inside EegProvider');
  }

  return value;
}
