import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { decodeEegSampleBlock } from './eegBinaryDecoder';
import type {
  EegDecodedSampleBlock,
  EegRecordingSession,
  EegStatus,
  EegStatusEvent,
  EegStreamConfig,
  EegStreamInfo,
  StartEegRecordingRequest,
} from './types';

export const EEG_STATUS_EVENT = 'eeg://status';

export function startEegStream(
  onBlock: (block: EegDecodedSampleBlock) => void,
  config?: Partial<EegStreamConfig>,
) {
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (data) => {
    const block = decodeEegSampleBlock(data);
    if (block) {
      onBlock(block);
    }
  };
  return invoke<EegStreamInfo>('start_eeg_stream', {
    config: config ?? null,
    onSampleBlock: channel,
  });
}

export function stopEegStream() {
  return invoke<void>('stop_eeg_stream');
}

export function startEegRecording(request: StartEegRecordingRequest) {
  return invoke<EegRecordingSession>('start_eeg_recording', { input: request });
}

export function stopEegRecording() {
  return invoke<EegRecordingSession>('stop_eeg_recording');
}

export function getEegStatus() {
  return invoke<EegStatus>('get_eeg_status');
}

export function listEegSessions(userId: string) {
  return invoke<EegRecordingSession[]>('list_eeg_sessions', { userId });
}

export function listenToEegStatusEvents(
  onStatus: (event: EegStatusEvent) => void,
) {
  return listen<EegStatusEvent>(EEG_STATUS_EVENT, (event) => {
    onStatus(event.payload);
  });
}
