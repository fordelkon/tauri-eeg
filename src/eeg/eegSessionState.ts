export type EegDeviceStatus = 'disconnected' | 'starting' | 'streaming' | 'error';

export type EegRecordStatus = 'idle' | 'recording' | 'paused' | 'stopped';

export type EegSessionState = {
  deviceStatus: EegDeviceStatus;
  recordStatus: EegRecordStatus;
  errorMessage: string | null;
};

export type EegSessionAction =
  | { type: 'start_device_requested' }
  | { type: 'start_device_succeeded' }
  | { type: 'start_device_failed'; message: string }
  | { type: 'start_record' }
  | { type: 'pause_record' }
  | { type: 'resume_record' }
  | { type: 'stop_record' }
  | { type: 'reset_error' };

export const initialEegSessionState: EegSessionState = {
  deviceStatus: 'disconnected',
  recordStatus: 'idle',
  errorMessage: null,
};

export function canStartDevice(state: EegSessionState) {
  return state.deviceStatus === 'disconnected' || state.deviceStatus === 'error';
}

export function canStartRecord(state: EegSessionState) {
  return state.deviceStatus === 'streaming' && state.recordStatus !== 'recording';
}

export function canPauseRecord(state: EegSessionState) {
  return state.deviceStatus === 'streaming' && state.recordStatus === 'recording';
}

export function canResumeRecord(state: EegSessionState) {
  return state.deviceStatus === 'streaming' && state.recordStatus === 'paused';
}

export function canStopRecord(state: EegSessionState) {
  return (
    state.deviceStatus === 'streaming' &&
    (state.recordStatus === 'recording' || state.recordStatus === 'paused')
  );
}

export function eegSessionReducer(
  state: EegSessionState,
  action: EegSessionAction,
): EegSessionState {
  switch (action.type) {
    case 'start_device_requested':
      if (!canStartDevice(state)) {
        return state;
      }

      return { ...state, deviceStatus: 'starting', errorMessage: null };

    case 'start_device_succeeded':
      return { ...state, deviceStatus: 'streaming', recordStatus: 'idle', errorMessage: null };

    case 'start_device_failed':
      return { ...state, deviceStatus: 'error', errorMessage: action.message };

    case 'start_record':
      if (!canStartRecord(state)) {
        return state;
      }

      return { ...state, recordStatus: 'recording', errorMessage: null };

    case 'pause_record':
      if (!canPauseRecord(state)) {
        return state;
      }

      return { ...state, recordStatus: 'paused' };

    case 'resume_record':
      if (!canResumeRecord(state)) {
        return state;
      }

      return { ...state, recordStatus: 'recording' };

    case 'stop_record':
      if (!canStopRecord(state)) {
        return state;
      }

      return { ...state, recordStatus: 'stopped' };

    case 'reset_error':
      return { ...state, errorMessage: null };

    default:
      return state;
  }
}
