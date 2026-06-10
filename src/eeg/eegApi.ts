import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { EegSampleBlockPayload, EegStreamInfo } from './types';

export const EEG_SAMPLE_BLOCK_EVENT = 'eeg://sample-block';

export function startEegStream() {
  return invoke<EegStreamInfo>('start_eeg_stream');
}

export function stopEegStream() {
  return invoke<void>('stop_eeg_stream');
}

export function listenToEegSampleBlocks(
  onBlock: (payload: EegSampleBlockPayload) => void,
) {
  return listen<EegSampleBlockPayload>(EEG_SAMPLE_BLOCK_EVENT, (event) => {
    onBlock(event.payload);
  });
}
