import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  EegRecordingSession,
  EegSampleBlockPayload,
  EegStatus,
  EegStreamConfig,
  EegStreamInfo,
  StartEegRecordingRequest,
} from './types';

export const EEG_SAMPLE_BLOCK_EVENT = 'eeg://sample-block';

export function startEegStream(config?: Partial<EegStreamConfig>) {
  return invoke<EegStreamInfo>('start_eeg_stream', { config: config ?? null });
}

export function stopEegStream() {
  return invoke<void>('stop_eeg_stream');
}

export function startEegRecording(request: StartEegRecordingRequest) {
  return invoke<EegRecordingSession>('start_eeg_recording', { input: request });
}

export function stopEegRecording() {
  return invoke<void>('stop_eeg_recording');
}

export function getEegStatus() {
  return invoke<EegStatus>('get_eeg_status');
}

export function listEegSessions(userId: string) {
  return invoke<EegRecordingSession[]>('list_eeg_sessions', { userId });
}

export function listenToEegSampleBlocks(
  onBlock: (payload: EegSampleBlockPayload) => void,
) {
  return listen<EegSampleBlockPayload>(EEG_SAMPLE_BLOCK_EVENT, (event) => {
    onBlock(event.payload);
  });
}
