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
import { describeEegError } from './eegErrorMessages';
import { MAX_DISPLAY_POINTS_PER_CHANNEL } from './eegDisplayFrame';
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
  type EegFailedAction,
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
  StartEegRecordingRequest,
} from './types';
import type { ParadigmInfo } from './paradigm/types';

const DEVICE_START_TIMEOUT_MS = 30_000;

// Raised locally (no underlying error object); the raw keys live next to
// their translations in eegErrorMessages, so route them through it too.
const DEVICE_START_TIMEOUT_ERROR =
  'Timed out waiting for the EEG device to connect. Check the device and try again.';
const SIGN_IN_REQUIRED_ERROR = 'Sign in before recording EEG.';

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
  getLatestSequence: () => number | null;
  lastFailedAction: EegFailedAction | null;
  lastRecording: EegRecordingSession | null;
  pauseRecord: () => boolean;
  recordStatus: typeof initialEegSessionState.recordStatus;
  /**
   * Clears a lingering errorMessage. Callers that are about to issue their own
   * command (e.g. the paradigm start) use it so stale failures cannot be read
   * as the new command's result.
   */
  resetError: () => void;
  /**
   * Plot viewport width reported by the mounted waveform panel (null when
   * none is). takeSnapshot pre-decimates only against the exact point budget
   * the panel's next frame build will use, so the two layers must agree on
   * the live width (see EegSnapshotDecimation).
   */
  reportPlotWidthPx: (widthPx: number | null) => void;
  resetBuffer: () => void;
  /** Re-runs the command that produced the current errorMessage; the error
   * banner's 重试 button. Resolves false when nothing is retryable or the
   * state machine refuses the re-run. */
  retryLastFailedAction: () => Promise<boolean>;
  resumeRecord: () => boolean;
  sampleRateHz: number;
  settings: EegDisplaySettings;
  setAmplitudeUvPerDiv: (amplitudeUvPerDiv: number) => void;
  setDisplayMode: (displayMode: EegDisplaySettings['displayMode']) => void;
  setTimeWindowSeconds: (timeWindowSeconds: number) => void;
  /** Resolves true when the start request was accepted; the connection itself
   * may complete moments later via the status poll. False = refused/failure. */
  startDevice: () => Promise<boolean>;
  /** Resolves true when the backend confirmed the recording started. */
  startRecord: (options?: { paradigm?: ParadigmInfo }) => Promise<boolean>;
  stopDevice: () => Promise<boolean>;
  /** Resolves true when the recording reached its saved terminal state;
   * false when the state machine refused or the backend rejected (the mapped
   * operator-facing copy is already in errorMessage either way). */
  stopRecord: () => Promise<boolean>;
  takeSnapshot: () => EegDisplaySnapshot;
  toggleChannel: (channelId: string) => void;
  /** Trigger-client connectivity, mirrored from the same status event stream. */
  triggerConnected: boolean;
};

const EegSessionContext = createContext<EegSessionContextValue | null>(null);

function eegStatusEventMessage(event: EegStatusEvent) {
  return describeEegError(event.reason, 'EEG device disconnected.');
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
  // The trigger client is not part of the device state machine (it never gates
  // start/stop commands), but the paradigm setup gate needs its connectivity.
  const [triggerConnected, setTriggerConnected] = useState(false);
  // Latest-value slot for the waveform panel's measured width. A ref, not
  // state: resize events must not re-render every context consumer, and the
  // value is only read inside takeSnapshot at snapshot time.
  const plotWidthPxRef = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    listenToEegStatusEvents((event) => {
      if (event.client === 'trigger') {
        setTriggerConnected(event.connected);
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
          message: describeEegError(error, 'Failed to subscribe to EEG status events.'),
        });
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Single reconciliation query at mount: the backend may already be streaming
  // (hardware kept sending across an app restart, or the connect event fired
  // before this listener existed). Without this the state machine would stay
  // 'disconnected' forever and block recording until the next app launch.
  useEffect(() => {
    let disposed = false;

    getEegStatus()
      .then((status) => {
        if (disposed) {
          return;
        }
        setTriggerConnected(status.triggerConnected);
        if (status.eegConnected) {
          dispatchSession({ type: 'device_stream_adopted' });
        }
      })
      .catch(() => {
        // Backend not reachable yet; the status events and the explicit
        // start flow remain the recovery paths.
      });

    return () => {
      disposed = true;
    };
  }, []);

  // The boolean returns exist so callers (agent actions especially) can tell
  // "the command ran" from "the state machine silently refused" instead of
  // reporting success for a no-op. The mapped failure copy still lands in
  // errorMessage either way.
  const startDevice = useCallback(async (): Promise<boolean> => {
    if (!canStartDevice(sessionState)) {
      return false;
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
      // Request accepted; the connection may still be confirmed by the
      // polling effect below within the start timeout.
      return true;
    } catch (error) {
      dispatchSession({
        type: 'start_device_failed',
        message: describeEegError(error, 'Failed to start EEG stream.'),
      });
      return false;
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
          message: describeEegError(DEVICE_START_TIMEOUT_ERROR),
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

  const stopDevice = useCallback(async (): Promise<boolean> => {
    if (!canStopDevice(sessionState)) {
      return false;
    }

    dispatchSession({ type: 'stop_device_requested' });

    try {
      await stopEegStream();
      setStreamInfo(null);
      bufferRef.current.reset();
      dispatchSession({ type: 'stop_device_succeeded' });
      return true;
    } catch (error) {
      dispatchSession({
        type: 'stop_device_failed',
        message: describeEegError(error, 'Failed to stop EEG stream.'),
      });
      return false;
    }
  }, [sessionState]);

  const startRecord = useCallback(async (options?: { paradigm?: ParadigmInfo }): Promise<boolean> => {
    if (!canStartRecord(sessionState)) {
      return false;
    }

    if (!currentUser) {
      dispatchSession({
        type: 'start_record_failed',
        message: describeEegError(SIGN_IN_REQUIRED_ERROR),
      });
      return false;
    }

    const request: StartEegRecordingRequest = {
      userId: currentUser.id,
      username: currentUser.username,
    };
    // Only include the paradigm key for paradigm runs so free recordings keep
    // the exact legacy payload.
    if (options?.paradigm) {
      request.paradigm = options.paradigm;
    }

    try {
      await startEegRecording(request);
      dispatchSession({ type: 'start_record' });
      return true;
    } catch (error) {
      dispatchSession({
        type: 'start_record_failed',
        message: describeEegError(error, 'Failed to start EEG recording.'),
      });
      return false;
    }
  }, [currentUser, sessionState]);

  const pauseRecord = useCallback((): boolean => {
    if (!canPauseRecord(sessionState)) {
      return false;
    }

    dispatchSession({ type: 'pause_record' });
    return true;
  }, [sessionState]);

  const resumeRecord = useCallback((): boolean => {
    if (!canResumeRecord(sessionState)) {
      return false;
    }

    dispatchSession({ type: 'resume_record' });
    return true;
  }, [sessionState]);

  const stopRecord = useCallback(async (): Promise<boolean> => {
    if (!canStopRecord(sessionState)) {
      return false;
    }

    try {
      const session = await stopEegRecording();
      setLastRecording(session);
      dispatchSession({ type: 'stop_record' });
      return true;
    } catch (error) {
      dispatchSession({
        type: 'stop_record_failed',
        message: describeEegError(error, 'Failed to stop EEG recording.'),
      });
      return false;
    }
  }, [sessionState]);

  const resetBuffer = useCallback(() => {
    bufferRef.current.reset();
  }, []);

  const resetError = useCallback(() => {
    dispatchSession({ type: 'reset_error' });
  }, []);

  const retryLastFailedAction = useCallback((): Promise<boolean> => {
    switch (sessionState.lastFailedAction) {
      case 'startDevice':
        return startDevice();
      case 'stopDevice':
        return stopDevice();
      case 'startRecord':
        return startRecord();
      case 'stopRecord':
        return stopRecord();
      default:
        return Promise.resolve(false);
    }
  }, [sessionState.lastFailedAction, startDevice, startRecord, stopDevice, stopRecord]);

  const setTimeWindowSeconds = useCallback((timeWindowSeconds: number) => {
    setSettings((current) => ({ ...current, timeWindowSeconds }));
  }, []);

  const setAmplitudeUvPerDiv = useCallback((amplitudeUvPerDiv: number) => {
    setSettings((current) => ({ ...current, amplitudeUvPerDiv }));
  }, []);

  const setDisplayMode = useCallback((displayMode: EegDisplaySettings['displayMode']) => {
    setSettings((current) => ({ ...current, displayMode }));
  }, []);

  const toggleChannel = useCallback((channelId: string) => {
    setSettings((current) => {
      const visibleChannelIds = toggleEegChannelVisibility(current.visibleChannelIds, channelId);

      return { ...current, visibleChannelIds };
    });
  }, []);

  const reportPlotWidthPx = useCallback((widthPx: number | null) => {
    plotWidthPxRef.current = widthPx;
  }, []);

  const takeSnapshot = useCallback(() => {
    // Mirror the waveform panel's frame memo parameter-for-parameter (width *
    // 2 capped at the shared budget; clip = amplitude * 5): with a match,
    // processEegDisplayFrame recognizes its own election in decimatedFor and
    // reproduces the full-copy frame bit-for-bit at survivor-only cost.
    const plotWidthPx = plotWidthPxRef.current;
    const decimation = plotWidthPx === null
      ? undefined
      : {
        targetPointCount: Math.min(MAX_DISPLAY_POINTS_PER_CHANNEL, plotWidthPx * 2),
        clipUv: settings.amplitudeUvPerDiv * 5,
      };
    return bufferRef.current.toDisplayData(
      settings.visibleChannelIds,
      settings.timeWindowSeconds,
      decimation,
    );
  }, [settings.amplitudeUvPerDiv, settings.timeWindowSeconds, settings.visibleChannelIds]);

  // Cheap probe for the render loop: lets it skip snapshot construction and
  // React updates entirely on frames where no new blocks arrived.
  const getLatestSequence = useCallback(() => bufferRef.current.getLastSequence(), []);

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
    getLatestSequence,
    lastFailedAction: sessionState.lastFailedAction,
    lastRecording,
    pauseRecord,
    recordStatus: sessionState.recordStatus,
    reportPlotWidthPx,
    resetBuffer,
    resetError,
    retryLastFailedAction,
    resumeRecord,
    sampleRateHz: streamInfo?.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ,
    settings,
    setAmplitudeUvPerDiv,
    setDisplayMode,
    setTimeWindowSeconds,
    startDevice,
    startRecord,
    stopDevice,
    stopRecord,
    takeSnapshot,
    toggleChannel,
    triggerConnected,
  }), [
    channels,
    getLatestSequence,
    lastRecording,
    pauseRecord,
    reportPlotWidthPx,
    resetBuffer,
    resetError,
    retryLastFailedAction,
    resumeRecord,
    sessionState,
    settings,
    setAmplitudeUvPerDiv,
    setDisplayMode,
    setTimeWindowSeconds,
    startDevice,
    startRecord,
    stopDevice,
    stopRecord,
    streamInfo?.sampleRateHz,
    takeSnapshot,
    toggleChannel,
    triggerConnected,
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
