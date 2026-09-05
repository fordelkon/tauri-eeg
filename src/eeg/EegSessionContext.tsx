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
} from 'react';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_EEG_CHANNELS } from './channels';
import { MAX_DISPLAY_POINTS_PER_CHANNEL } from './eegDisplayFrame';
import { EegRingBuffer } from './eegRingBuffer';
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
import { useEegDeviceCommands } from './useEegDeviceCommands';
import { useEegRecordingCommands } from './useEegRecordingCommands';
import { useEegStatusReconciliation } from './useEegStatusReconciliation';
import type {
  EegDisplaySettings,
  EegDisplaySnapshot,
  EegRecordingSession,
  EegStreamInfo,
} from './types';
import type { ParadigmInfo } from './paradigm/types';

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
   * none is). takeSnapshot pre-decimates against the point budget the panel's
   * next frame build will use (width * 2 capped at the shared budget; before
   * a width is reported, the shared budget itself), so the two layers agree
   * on the live width (see EegSnapshotDecimation).
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

/**
 * Narrow slice for chrome-level consumers (the Home shell) whose rendering
 * depends only on whether a recording is running. Subscribing them to the
 * full session value re-renders the entire app shell on every display tweak
 * (channel toggles, amplitude, time window) even though the recording state
 * did not change, because the merged value identity covers `settings`.
 */
type EegRecordingControlValue = {
  recordStatus: typeof initialEegSessionState.recordStatus;
  stopRecord: () => Promise<boolean>;
};

const EegRecordingControlContext = createContext<EegRecordingControlValue | null>(null);

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

  // Status event subscription + mount reconciliation (device/trigger/adopt).
  useEegStatusReconciliation({ dispatchSession, bufferRef, setStreamInfo, setTriggerConnected });

  // The command guards are pure functions of (deviceStatus, recordStatus), so
  // they are evaluated once per render here and the command callbacks below
  // capture the resulting booleans instead of the whole sessionState object.
  // Each captured boolean is computed from the same committed state the object
  // dep used to carry into the callback body, so call-time refusal behavior is
  // identical — but a command callback now changes identity only when its own
  // guard flips, instead of on every reducer transition (error and
  // lastFailedAction churn included).
  const canStartDeviceNow = canStartDevice(sessionState);
  const canStopDeviceNow = canStopDevice(sessionState);
  const canStartRecordNow = canStartRecord(sessionState);
  const canPauseRecordNow = canPauseRecord(sessionState);
  const canResumeRecordNow = canResumeRecord(sessionState);
  const canStopRecordNow = canStopRecord(sessionState);

  // Device (stream) command slice: start/stop plus the start-timeout poll.
  const { startDevice, stopDevice } = useEegDeviceCommands({
    canStartDeviceNow,
    canStopDeviceNow,
    deviceStatus: sessionState.deviceStatus,
    dispatchSession,
    bufferRef,
    setStreamInfo,
  });

  // Recording command slice: start/pause/resume/stop-and-save.
  const { pauseRecord, resumeRecord, startRecord, stopRecord } = useEegRecordingCommands({
    canStartRecordNow,
    canPauseRecordNow,
    canResumeRecordNow,
    canStopRecordNow,
    currentUser,
    dispatchSession,
    setLastRecording,
  });

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
    // Before the panel's ResizeObserver has reported a width, fall back to the
    // shared budget rather than the non-decimated path: undecimated snapshots
    // copy the whole window (~1 MB per channel at 30 s × 1 kHz) per tick, and
    // a frame build at a narrower width simply re-selects over these
    // survivors.
    const plotWidthPx = plotWidthPxRef.current;
    const decimation = {
      targetPointCount: plotWidthPx === null
        ? MAX_DISPLAY_POINTS_PER_CHANNEL
        : Math.min(MAX_DISPLAY_POINTS_PER_CHANNEL, plotWidthPx * 2),
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

  // Dep note: the value exposes the four sessionState fields directly, so the
  // memo keys on those primitives (plus the precomputed guard booleans)
  // instead of the sessionState object. Recompute timing is unchanged — every
  // reducer transition that actually changes state changes at least one
  // exposed field — but the command callbacks inside the value keep their
  // identity across guard-irrelevant transitions.
  const value = useMemo<EegSessionContextValue>(() => ({
    bufferRef,
    canPauseRecord: canPauseRecordNow,
    canResumeRecord: canResumeRecordNow,
    canStartDevice: canStartDeviceNow,
    canStartRecord: canStartRecordNow,
    canStopDevice: canStopDeviceNow,
    canStopRecord: canStopRecordNow,
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
    canPauseRecordNow,
    canResumeRecordNow,
    canStartDeviceNow,
    canStartRecordNow,
    canStopDeviceNow,
    canStopRecordNow,
    channels,
    getLatestSequence,
    lastRecording,
    pauseRecord,
    reportPlotWidthPx,
    resetBuffer,
    resetError,
    retryLastFailedAction,
    resumeRecord,
    sessionState.deviceStatus,
    sessionState.errorMessage,
    sessionState.lastFailedAction,
    sessionState.recordStatus,
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

  // Narrow slice for the recording-control context. stopRecord changes
  // identity only when its canStopRecord guard flips (device/record
  // lifecycle); display settings updates never touch this value.
  const recordingControlValue = useMemo<EegRecordingControlValue>(() => ({
    recordStatus: sessionState.recordStatus,
    stopRecord,
  }), [sessionState.recordStatus, stopRecord]);

  return (
    <EegSessionContext.Provider value={value}>
      <EegRecordingControlContext.Provider value={recordingControlValue}>
        {children}
      </EegRecordingControlContext.Provider>
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

export function useEegRecordingControl() {
  const value = useContext(EegRecordingControlContext);

  if (!value) {
    throw new Error('useEegRecordingControl must be used inside EegProvider');
  }

  return value;
}
