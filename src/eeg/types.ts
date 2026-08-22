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

export type EegDisplaySettings = {
  timeWindowSeconds: number;
  amplitudeUvPerDiv: number;
  visibleChannelIds: Set<string>;
};

export type EegDisplaySnapshot = {
  latestSequence: number | null;
  x: number[];
  visibleChannels: EegChannel[];
  seriesByChannel: Record<string, number[]>;
  baselineByChannel: Record<string, number>;
  markers: EegMarker[];
  retainedSampleCount: number;
};

export type EegMarker = {
  timeSeconds: number;
  classId: EegTriggerCode;
};

export type EegTriggerCode = 1 | 2 | 255;
