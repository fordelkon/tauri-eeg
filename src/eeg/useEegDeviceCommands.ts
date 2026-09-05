import { useCallback, useEffect, type Dispatch, type MutableRefObject } from 'react';
import type { SetStateAction } from 'react';
import { getEegStatus, startEegStream, stopEegStream } from './eegApi';
import { describeEegError } from './eegErrorMessages';
import { EegRingBuffer } from './eegRingBuffer';
import type { eegSessionReducer } from './eegSessionState';
import type { EegStreamInfo } from './types';

type EegSessionAction = Parameters<typeof eegSessionReducer>[1];

const DEVICE_START_TIMEOUT_MS = 30_000;

// Raised locally (no underlying error object); the raw keys live next to
// their translations in eegErrorMessages, so route them through it too.
const DEVICE_START_TIMEOUT_ERROR =
  'Timed out waiting for the EEG device to connect. Check the device and try again.';

/**
 * Device (stream) command slice of the EEG session provider: start/stop of
 * the backend stream, plus the start-timeout poll that catches the
 * event-less connection path within 30s. Boolean returns let callers (agent
 * actions especially) tell "the command ran" from "the state machine
 * silently refused"; the mapped failure copy lands in errorMessage either
 * way.
 */
export function useEegDeviceCommands(options: {
  canStartDeviceNow: boolean;
  canStopDeviceNow: boolean;
  deviceStatus: string;
  dispatchSession: Dispatch<EegSessionAction>;
  bufferRef: MutableRefObject<EegRingBuffer>;
  setStreamInfo: Dispatch<SetStateAction<EegStreamInfo | null>>;
}) {
  const {
    canStartDeviceNow,
    canStopDeviceNow,
    deviceStatus,
    dispatchSession,
    bufferRef,
    setStreamInfo,
  } = options;

  const startDevice = useCallback(async (): Promise<boolean> => {
    if (!canStartDeviceNow) {
      return false;
    }

    dispatchSession({ type: 'start_device_requested' });

    try {
      const info = await startEegStream((block) => {
        bufferRef.current.appendPayload(block);
      });
      setStreamInfo(info);
      // No serialized status roundtrip here: the eeg://status listener above
      // dispatches device_connected (starting → streaming) the moment the
      // backend reports the connection, and the polling effect below catches
      // the event-less path within the start timeout. Request accepted; the
      // connection confirmation must not gate this answer.
      return true;
    } catch (error) {
      dispatchSession({
        type: 'start_device_failed',
        message: describeEegError(error, 'Failed to start EEG stream.'),
      });
      return false;
    }
  }, [canStartDeviceNow, dispatchSession, bufferRef, setStreamInfo]);

  useEffect(() => {
    if (deviceStatus !== 'starting') {
      return undefined;
    }

    let cancelled = false;
    const startedAtMs = Date.now();
    const interval = window.setInterval(() => {
      if (Date.now() - startedAtMs >= DEVICE_START_TIMEOUT_MS) {
        dispatchSession({
          type: 'start_device_failed',
          message: describeEegError(DEVICE_START_TIMEOUT_ERROR),
        });
        return;
      }

      getEegStatus()
        .then((status) => {
          if (cancelled) {
            return;
          }
          if (status.eegConnected) {
            dispatchSession({ type: 'start_device_succeeded' });
          }
        })
        .catch(() => {
          // Keep the device start button available for another explicit attempt.
        });
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [deviceStatus, dispatchSession]);

  const stopDevice = useCallback(async (): Promise<boolean> => {
    if (!canStopDeviceNow) {
      return false;
    }

    dispatchSession({ type: 'stop_device_requested' });

    try {
      await stopEegStream();
      setStreamInfo(null);
      bufferRef.current.reset();
      dispatchSession({ type: 'stop_device_succeeded' });
      return true;
    } catch (error) {
      dispatchSession({
        type: 'stop_device_failed',
        message: describeEegError(error, 'Failed to stop EEG stream.'),
      });
      return false;
    }
  }, [canStopDeviceNow, dispatchSession, bufferRef, setStreamInfo]);

  return { startDevice, stopDevice };
}
