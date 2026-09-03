export type EegDeviceStatus = 'disconnected' | 'starting' | 'streaming' | 'stopping' | 'error';

export type EegRecordStatus = 'idle' | 'recording' | 'paused' | 'stopped';

/** The command whose failure produced the current errorMessage; the error
 * banner's retry re-runs it. A device drop maps to startDevice because
 * reconnecting is the operator's recovery path. */
export type EegFailedAction = 'startDevice' | 'stopDevice' | 'startRecord' | 'stopRecord';

export type EegSessionState = {
  deviceStatus: EegDeviceStatus;
  recordStatus: EegRecordStatus;
  errorMessage: string | null;
  lastFailedAction: EegFailedAction | null;
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
  /** Mount-time reconciliation: the backend was already streaming before this
   * session existed, so no connect event will ever arrive. */
  | { type: 'device_stream_adopted' }
  /** Mount-time reconciliation: the backend was already recording before this
   * session existed (reload during an active recording), so no start_record
   * confirmation will ever arrive. */
  | { type: 'recording_adopted' }
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
  lastFailedAction: null,
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

      return { ...state, deviceStatus: 'starting', errorMessage: null, lastFailedAction: null };

    case 'start_device_succeeded':
      return {
        ...state,
        deviceStatus: 'streaming',
        recordStatus: 'idle',
        errorMessage: null,
        lastFailedAction: null,
      };

    case 'start_device_failed':
      return { ...state, deviceStatus: 'error', errorMessage: action.message, lastFailedAction: 'startDevice' };

    case 'stop_device_requested':
      if (!canStopDevice(state)) {
        return state;
      }

      return { ...state, deviceStatus: 'stopping', errorMessage: null, lastFailedAction: null };

    case 'stop_device_succeeded':
      return {
        ...state,
        deviceStatus: 'disconnected',
        // A recording that was stopped-and-saved just before the stream halt
        // keeps its terminal state so the result banner stays visible.
        recordStatus: state.recordStatus === 'stopped' ? state.recordStatus : 'idle',
        errorMessage: null,
        lastFailedAction: null,
      };

    case 'stop_device_failed':
      return { ...state, deviceStatus: 'error', errorMessage: action.message, lastFailedAction: 'stopDevice' };

    case 'device_connected':
      // Emitted by the backend when EEG client data starts flowing again.
      if (state.deviceStatus === 'starting') {
        return {
          ...state,
          deviceStatus: 'streaming',
          recordStatus: 'idle',
          errorMessage: null,
          lastFailedAction: null,
        };
      }
      if (state.deviceStatus === 'error') {
        return { ...state, deviceStatus: 'streaming', errorMessage: null, lastFailedAction: null };
      }
      return state;

    case 'device_stream_adopted':
      // Only the fresh-mount 'disconnected' state adopts; an explicit user or
      // error path must keep its own transition semantics.
      if (state.deviceStatus === 'disconnected') {
        return {
          ...state,
          deviceStatus: 'streaming',
          errorMessage: null,
          lastFailedAction: null,
        };
      }
      return state;

    case 'recording_adopted':
      // Mount-time mirror of device_stream_adopted, one step deeper: the
      // backend was already recording when this UI came up (reload during an
      // active free/effect-evaluation recording). Only a fresh-mount
      // 'idle' record state adopts — explicitly started recordings already
      // reflect reality, and 'stopped' belongs to the result banner until the
      // next explicit start. Adoption must also survive device adoption order
      // (the reconcile dispatches stream adoption first, so deviceStatus is
      // already 'streaming' by the time this action lands).
      if (state.deviceStatus === 'streaming' && state.recordStatus === 'idle') {
        return { ...state, recordStatus: 'recording' };
      }
      return state;

    case 'device_disconnected':
      // Ignore the events that accompany an explicit user stop; a 'stopping'
      // state transitions to 'disconnected' through stop_device_succeeded.
      // The failure maps to startDevice: reconnecting is the recovery path.
      if (state.deviceStatus === 'streaming' || state.deviceStatus === 'starting') {
        return {
          ...state,
          deviceStatus: 'error',
          errorMessage: action.message,
          lastFailedAction: 'startDevice',
        };
      }
      return state;

    case 'start_record':
      if (!canStartRecord(state)) {
        return state;
      }

      return { ...state, recordStatus: 'recording', errorMessage: null, lastFailedAction: null };

    case 'start_record_failed':
      return { ...state, errorMessage: action.message, lastFailedAction: 'startRecord' };

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

      return { ...state, recordStatus: 'stopped', lastFailedAction: null };

    case 'stop_record_failed':
      if (state.recordStatus !== 'recording' && state.recordStatus !== 'paused') {
        return state;
      }

      return { ...state, errorMessage: action.message, lastFailedAction: 'stopRecord' };

    case 'reset_error':
      return { ...state, errorMessage: null, lastFailedAction: null };

    default:
      return state;
  }
}
