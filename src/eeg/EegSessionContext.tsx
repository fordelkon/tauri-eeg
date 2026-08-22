import {
  createContext,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_EEG_CHANNELS } from './channels';
import { EegRingBuffer } from './eegRingBuffer';
import {
  getEegStatus,
  listenToEegStatusEvents,
  startEegRecording,
  startEegStream,
  stopEegStream,
  stopEegRecording,
} from './eegApi';
import {
  canPauseRecord,
  canResumeRecord,
  canStartDevice,
  canStartRecord,
  canStopDevice,
  canStopRecord,
  eegSessionReducer,
  initialEegSessionState,
} from './eegSessionState';
import {
  DEFAULT_SAMPLE_RATE_HZ,
  EEG_TIME_WINDOW_OPTIONS_SECONDS,
  createInitialEegDisplaySettings,
  toggleEegChannelVisibility,
} from './eegSessionStore';
import type {
  EegDisplaySettings,
  EegDisplaySnapshot,
  EegRecordingSession,
  EegStatusEvent,
  EegStreamInfo,
} from './types';

const DEVICE_START_TIMEOUT_MS = 30_000;

type EegSessionContextValue = {
  bufferRef: MutableRefObject<EegRingBuffer>;
  canPauseRecord: boolean;
  canResumeRecord: boolean;
  canStartDevice: boolean;
  canStartRecord: boolean;
  canStopDevice: boolean;
  canStopRecord: boolean;
  channels: typeof DEFAULT_EEG_CHANNELS;
  deviceStatus: typeof initialEegSessionState.deviceStatus;
  errorMessage: string | null;
  lastRecording: EegRecordingSession | null;
  pauseRecord: () => void;
  recordStatus: typeof initialEegSessionState.recordStatus;
  resetBuffer: () => void;
  resumeRecord: () => void;
  sampleRateHz: number;
  settings: EegDisplaySettings;
  setAmplitudeUvPerDiv: (amplitudeUvPerDiv: number) => void;
  setTimeWindowSeconds: (timeWindowSeconds: number) => void;
  startDevice: () => Promise<void>;
  startRecord: () => Promise<void>;
  stopDevice: () => Promise<void>;
  stopRecord: () => Promise<void>;
  takeSnapshot: () => EegDisplaySnapshot;
  toggleChannel: (channelId: string) => void;
};

const EegSessionContext = createContext<EegSessionContextValue | null>(null);

function eegStatusEventMessage(event: EegStatusEvent) {
  return event.reason ?? 'EEG device disconnected.';
}

export function EegProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const channels = DEFAULT_EEG_CHANNELS;
  const bufferRef = useRef(new EegRingBuffer(
    channels,
    DEFAULT_SAMPLE_RATE_HZ,
    Math.max(...EEG_TIME_WINDOW_OPTIONS_SECONDS),
  ));

  const [streamInfo, setStreamInfo] = useState<EegStreamInfo | null>(null);
  const [sessionState, dispatchSession] = useReducer(eegSessionReducer, initialEegSessionState);
  const [settings, setSettings] = useState<EegDisplaySettings>(createInitialEegDisplaySettings);
  const [lastRecording, setLastRecording] = useState<EegRecordingSession | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    listenToEegStatusEvents((event) => {
      if (event.client === 'trigger') {
        return;
      }
      if (event.connected) {
        dispatchSession({ type: 'device_connected' });
      } else {
        dispatchSession({
          type: 'device_disconnected',
          message: eegStatusEventMessage(event),
        });
      }
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
          message: typeof error === 'string' ? error : 'Failed to subscribe to EEG status events.',
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
      const info = await startEegStream((block) => {
        bufferRef.current.appendPayload(block);
      });
      setStreamInfo(info);
      const status = await getEegStatus();
      if (status.eegConnected) {
        dispatchSession({ type: 'start_device_succeeded' });
      }
    } catch (error) {
      dispatchSession({
        type: 'start_device_failed',
        message: typeof error === 'string' ? error : 'Failed to start EEG stream.',
      });
    }
  }, [sessionState]);

  useEffect(() => {
    if (sessionState.deviceStatus !== 'starting') {
      return undefined;
    }

    let cancelled = false;
    const startedAtMs = Date.now();
    const interval = window.setInterval(() => {
      if (Date.now() - startedAtMs >= DEVICE_START_TIMEOUT_MS) {
        dispatchSession({
          type: 'start_device_failed',
          message: 'Timed out waiting for the EEG device to connect. Check the device and try again.',
        });
        return;
      }

      getEegStatus()
        .then((status) => {
          if (cancelled) {
            return;
          }
          if (status.eegConnected) {
            dispatchSession({ type: 'start_device_succeeded' });
          }
        })
        .catch(() => {
          // Keep the device start button available for another explicit attempt.
        });
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [sessionState.deviceStatus]);

  const stopDevice = useCallback(async () => {
    if (!canStopDevice(sessionState)) {
      return;
    }

    dispatchSession({ type: 'stop_device_requested' });

    try {
      await stopEegStream();
      setStreamInfo(null);
      bufferRef.current.reset();
      dispatchSession({ type: 'stop_device_succeeded' });
    } catch (error) {
      dispatchSession({
        type: 'stop_device_failed',
        message: typeof error === 'string' ? error : 'Failed to stop EEG stream.',
      });
    }
  }, [sessionState]);

  const startRecord = useCallback(async () => {
    if (!canStartRecord(sessionState)) {
      return;
    }

    if (!currentUser) {
      dispatchSession({
        type: 'start_record_failed',
        message: 'Sign in before recording EEG.',
      });
      return;
    }

    try {
      await startEegRecording({
        userId: currentUser.id,
        username: currentUser.username,
      });
      dispatchSession({ type: 'start_record' });
    } catch (error) {
      dispatchSession({
        type: 'start_record_failed',
        message: typeof error === 'string' ? error : 'Failed to start EEG recording.',
      });
    }
  }, [currentUser, sessionState]);

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

  const stopRecord = useCallback(async () => {
    if (!canStopRecord(sessionState)) {
      return;
    }

    try {
      const session = await stopEegRecording();
      setLastRecording(session);
      dispatchSession({ type: 'stop_record' });
    } catch (error) {
      dispatchSession({
        type: 'stop_record_failed',
        message: typeof error === 'string' ? error : 'Failed to stop EEG recording.',
      });
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
      const visibleChannelIds = toggleEegChannelVisibility(current.visibleChannelIds, channelId);

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
    canStopDevice: canStopDevice(sessionState),
    canStopRecord: canStopRecord(sessionState),
    channels,
    deviceStatus: sessionState.deviceStatus,
    errorMessage: sessionState.errorMessage,
    lastRecording,
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
    stopDevice,
    stopRecord,
    takeSnapshot,
    toggleChannel,
  }), [
    channels,
    lastRecording,
    pauseRecord,
    resetBuffer,
    resumeRecord,
    sessionState,
    settings,
    setAmplitudeUvPerDiv,
    setTimeWindowSeconds,
    startDevice,
    startRecord,
    stopDevice,
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
