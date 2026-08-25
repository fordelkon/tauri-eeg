import type { ParadigmInfo } from './paradigm/types';

export type EegChannel = {
  id: string;
  label: string;
  unit: 'uV';
};

export type EegStreamInfo = {
  bindHost: string;
  tcpPort: number;
  sampleRateHz: number;
  blockIntervalMs: number;
  channelIds: string[];
};

export type EegStreamConfig = {
  bindHost: string;
  tcpPort: number;
  deviceHost: string;
  deviceUdpPort: number;
  eegDeviceIp: string;
  triggerDeviceIp: string;
  sampleRateHz: number;
  blockIntervalMs: number;
};

export type StartEegRecordingRequest = {
  userId: string;
  username: string;
  /** Present when the recording is an emotion induction paradigm session. */
  paradigm?: ParadigmInfo;
};

export type EegRecordingSession = {
  id: string;
  userId: string;
  username: string;
  sessionDir: string;
  eegFile: string;
  triggerFile: string;
  metadataFile: string;
  sampleRateHz: number;
  channelCount: number;
  sampleCount: number;
  durationSeconds: number | null;
  startedAt: string;
  endedAt: string | null;
};

export type EegStatus = {
  isStreaming: boolean;
  isRecording: boolean;
  eegConnected: boolean;
  triggerConnected: boolean;
  lastError: string | null;
  lastDisconnectReason: string | null;
  sampleRateHz: number;
  blockIntervalMs: number;
  channelIds: string[];
  paddedSamples: number;
  activeRecording: EegRecordingSession | null;
};

export type EegStatusClientKind = 'eeg' | 'trigger' | 'stream';

export type EegStatusEvent = {
  client: EegStatusClientKind;
  connected: boolean;
  reason: string | null;
};

/**
 * Decoded binary sample block sent over a Tauri IPC channel: per-channel
 * Float32Arrays in channel order (ch01..ch32).
 */
export type EegDecodedSampleBlock = {
  sequence: number;
  sampleRateHz: number;
  startedAtMs: number;
  triggerClass: number | null;
  samples: Float32Array[];
};

/**
 * 'sweep' = BioSemi-style fixed page: the trace writes left→right behind a
 * cursor and overwrites the previous cycle in place. 'scroll' = sliding
 * window that follows the newest sample.
 */
export type EegDisplayMode = 'sweep' | 'scroll';

export type EegDisplaySettings = {
  timeWindowSeconds: number;
  amplitudeUvPerDiv: number;
  visibleChannelIds: Set<string>;
  displayMode: EegDisplayMode;
};

/**
 * Snapshot handed to the render loop 30 times a second. Typed arrays keep the
 * hot path allocation-light: boxing the window into plain number[] arrays was
 * the dominant GC cost of the realtime display.
 */
export type EegDisplaySnapshot = {
  latestSequence: number | null;
  x: Float64Array;
  visibleChannels: EegChannel[];
  seriesByChannel: Record<string, Float32Array>;
  baselineByChannel: Record<string, number>;
  markers: EegMarker[];
  retainedSampleCount: number;
  /**
   * Absolute time of the newest retained sample. Present on decimated
   * snapshots, whose x axis stops at the last SURVIVING sample — frame
   * builders need the true tail for cursor/cycle bookkeeping (see
   * {@link decimatedFor}).
   */
  latestTimeSeconds?: number;
  /**
   * Present when x/seriesByChannel were already min-max decimated by the ring
   * for exactly these frame parameters. processEegDisplayFrame then skips its
   * own selection stage: the survivor set is precisely the one it would have
   * elected from the full window (shared bucket geometry and clip limit), so
   * re-decimating would compound the loss instead of refining it.
   */
  decimatedFor?: {
    targetPointCount: number;
    /** Post-clamp clip limit the extrema comparisons ran with. */
    clipLimit: number;
  };
};

export type EegMarker = {
  timeSeconds: number;
  classId: EegTriggerCode;
};

export type EegTriggerCode = 1 | 2 | 3 | 4 | 255;
