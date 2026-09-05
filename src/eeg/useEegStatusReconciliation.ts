import { useEffect, type Dispatch, type MutableRefObject } from 'react';
import { getEegStatus, listenToEegStatusEvents, startEegStream } from './eegApi';
import { describeEegError } from './eegErrorMessages';
import { EegRingBuffer } from './eegRingBuffer';
import type { eegSessionReducer } from './eegSessionState';
import type { EegStatusEvent, EegStreamInfo } from './types';

type EegSessionAction = Parameters<typeof eegSessionReducer>[1];

function eegStatusEventMessage(event: EegStatusEvent) {
  return describeEegError(event.reason, 'EEG device disconnected.');
}

/**
 * Status-event + reconciliation slice of the EEG session provider: subscribes
 * to the eeg://status event mirror (device connect/disconnect, trigger
 * client) and runs the single mount reconciliation query so a webview reload
 * adopts an already-streaming backend (and a recording it is mid-way through)
 * instead of staying 'disconnected' forever.
 */
export function useEegStatusReconciliation(options: {
  dispatchSession: Dispatch<EegSessionAction>;
  bufferRef: MutableRefObject<EegRingBuffer>;
  setStreamInfo: (info: EegStreamInfo) => void;
  setTriggerConnected: (connected: boolean) => void;
}) {
  const { dispatchSession, bufferRef, setStreamInfo, setTriggerConnected } = options;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    listenToEegStatusEvents((event) => {
      if (event.client === 'trigger') {
        setTriggerConnected(event.connected);
        return;
      }
      if (event.connected) {
        dispatchSession({ type: 'device_connected' });
      } else {
        dispatchSession({
          type: 'device_disconnected',
          message: eegStatusEventMessage(event),
        });
      }
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }

        unlisten = nextUnlisten;
      })
      .catch((error) => {
        dispatchSession({
          type: 'start_device_failed',
          message: describeEegError(error, 'Failed to subscribe to EEG status events.'),
        });
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [dispatchSession, setTriggerConnected]);

  // Single reconciliation query at mount: the backend may already be streaming
  // (hardware kept sending across an app restart, or the connect event fired
  // before this listener existed). Without this the state machine would stay
  // 'disconnected' forever and block recording until the next app launch.
  useEffect(() => {
    let disposed = false;

    getEegStatus()
      .then(async (status) => {
        if (disposed) {
          return;
        }
        setTriggerConnected(status.triggerConnected);
        if (!status.eegConnected) {
          return;
        }

        // A running stream serves whichever IPC channel registered last, so
        // the reloaded webview must re-attach its channel to see live blocks
        // again (start_eeg_stream on a running stream swaps the channel).
        // A failure here falls back to state-only adoption: the controls and
        // status stay correct, only the live waveform stays dark.
        try {
          const info = await startEegStream((block) => {
            bufferRef.current.appendPayload(block);
          });
          if (disposed) {
            return;
          }
          setStreamInfo(info);
        } catch {
          // State-only adoption below.
        }

        if (disposed) {
          return;
        }
        dispatchSession({ type: 'device_stream_adopted' });

        // The backend may also be mid-recording (reload during a free or
        // effect-evaluation run): adopt it so the stop/pause controls exist
        // and the run does not outlive the UI that owns it.
        if (status.isRecording) {
          dispatchSession({ type: 'recording_adopted' });
        }
      })
      .catch(() => {
        // Backend not reachable yet; the status events and the explicit
        // start flow remain the recovery paths.
      });

    return () => {
      disposed = true;
    };
  }, [bufferRef, dispatchSession, setStreamInfo, setTriggerConnected]);
}
