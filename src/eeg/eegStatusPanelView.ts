import type { EegDeviceStatus, EegRecordStatus } from './eegSessionState';

type EegStatusPanelViewInput = {
  channelCount: number;
  deviceStatus: EegDeviceStatus;
  errorMessage: string | null;
  recordStatus: EegRecordStatus;
  retainedSampleCount: number;
  sampleRateHz: number;
  visibleChannelCount: number;
};

export type EegStatusPanelTone = 'offline' | 'pending' | 'online' | 'error';

export type EegStatusPanelView = {
  bufferLabel: string;
  channelsLabel: string;
  deviceLabel: string;
  errorMessage: string | null;
  headline: string;
  recordLabel: string;
  sampleRateLabel: string;
  tone: EegStatusPanelTone;
};

const deviceLabels: Record<EegDeviceStatus, string> = {
  disconnected: 'Disconnected',
  error: 'Error',
  starting: 'Starting',
  stopping: 'Stopping',
  streaming: 'Streaming',
};

const recordLabels: Record<EegRecordStatus, string> = {
  idle: 'Idle',
  paused: 'Paused',
  recording: 'Recording',
  stopped: 'Stopped',
};

export function buildEegStatusPanelView(input: EegStatusPanelViewInput): EegStatusPanelView {
  const hasError = Boolean(input.errorMessage);
  const tone: EegStatusPanelTone = hasError
    ? 'error'
    : input.deviceStatus === 'streaming'
      ? 'online'
      : input.deviceStatus === 'starting' || input.deviceStatus === 'stopping'
        ? 'pending'
        : 'offline';

  return {
    bufferLabel: `${input.retainedSampleCount.toLocaleString()} samples`,
    channelsLabel: `${input.visibleChannelCount}/${input.channelCount}`,
    deviceLabel: deviceLabels[input.deviceStatus],
    errorMessage: input.errorMessage,
    headline: hasError
      ? 'EEG Attention Required'
      : input.deviceStatus === 'streaming'
        ? 'EEG Live'
        : input.deviceStatus === 'starting'
          ? 'EEG Starting'
          : input.deviceStatus === 'stopping'
            ? 'EEG Stopping'
            : 'EEG Offline',
    recordLabel: recordLabels[input.recordStatus],
    sampleRateLabel: `${input.sampleRateHz.toLocaleString()} Hz`,
    tone,
  };
}
