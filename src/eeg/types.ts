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
  sampleRateHz: number;
  blockIntervalMs: number;
  channelIds: string[];
  activeRecording: EegRecordingSession | null;
};

export type EegSampleBlockPayload = {
  sequence: number;
  sampleRateHz: number;
  startedAtMs: number;
  channelIds: string[];
  samples: number[][];
  triggerClass?: EegTriggerCode | null;
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
  markers: EegMarker[];
  retainedSampleCount: number;
};

export type EegMarker = {
  timeSeconds: number;
  classId: EegTriggerCode;
};

export type EegTriggerCode = 1 | 2 | 255;
