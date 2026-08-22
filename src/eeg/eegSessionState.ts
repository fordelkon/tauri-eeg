export type EegDeviceStatus = 'disconnected' | 'starting' | 'streaming' | 'stopping' | 'error';

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
  | { type: 'stop_device_requested' }
  | { type: 'stop_device_succeeded' }
  | { type: 'stop_device_failed'; message: string }
  | { type: 'device_connected' }
  | { type: 'device_disconnected'; message: string }
  | { type: 'start_record' }
  | { type: 'start_record_failed'; message: string }
  | { type: 'pause_record' }
  | { type: 'resume_record' }
  | { type: 'stop_record' }
  | { type: 'stop_record_failed'; message: string }
  | { type: 'reset_error' };

export const initialEegSessionState: EegSessionState = {
  deviceStatus: 'disconnected',
  recordStatus: 'idle',
  errorMessage: null,
};

export function canStartDevice(state: EegSessionState) {
  return (
    state.deviceStatus === 'disconnected' ||
    state.deviceStatus === 'starting' ||
    state.deviceStatus === 'error'
  );
}

export function canStartRecord(state: EegSessionState) {
  return state.deviceStatus === 'streaming' && state.recordStatus !== 'recording';
}

export function canStopDevice(state: EegSessionState) {
  return state.deviceStatus === 'starting' || state.deviceStatus === 'streaming';
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

    case 'stop_device_requested':
      if (!canStopDevice(state)) {
        return state;
      }

      return { ...state, deviceStatus: 'stopping', errorMessage: null };

    case 'stop_device_succeeded':
      return { ...state, deviceStatus: 'disconnected', recordStatus: 'idle', errorMessage: null };

    case 'stop_device_failed':
      return { ...state, deviceStatus: 'error', errorMessage: action.message };

    case 'device_connected':
      // Emitted by the backend when EEG client data starts flowing again.
      if (state.deviceStatus === 'starting') {
        return { ...state, deviceStatus: 'streaming', recordStatus: 'idle', errorMessage: null };
      }
      if (state.deviceStatus === 'error') {
        return { ...state, deviceStatus: 'streaming', errorMessage: null };
      }
      return state;

    case 'device_disconnected':
      // Ignore the events that accompany an explicit user stop; a 'stopping'
      // state transitions to 'disconnected' through stop_device_succeeded.
      if (state.deviceStatus === 'streaming' || state.deviceStatus === 'starting') {
        return { ...state, deviceStatus: 'error', errorMessage: action.message };
      }
      return state;

    case 'start_record':
      if (!canStartRecord(state)) {
        return state;
      }

      return { ...state, recordStatus: 'recording', errorMessage: null };

    case 'start_record_failed':
      return { ...state, errorMessage: action.message };

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

    case 'stop_record_failed':
      if (state.recordStatus !== 'recording' && state.recordStatus !== 'paused') {
        return state;
      }

      return { ...state, errorMessage: action.message };

    case 'reset_error':
      return { ...state, errorMessage: null };

    default:
      return state;
  }
}
