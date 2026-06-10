export type EegChannel = {
  id: string;
  label: string;
  unit: 'uV';
};

export type EegStreamInfo = {
  sampleRateHz: number;
  blockIntervalMs: number;
  channelIds: string[];
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
