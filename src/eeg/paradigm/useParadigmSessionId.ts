import { useEffect } from 'react';
import { getEegStatus } from '../eegApi';
import type { ParadigmSessionAction } from './paradigmSessionState';

/**
 * Delay before the single mount retry of the session-id resolution. The finish
 * chain reads state.sessionId directly, so one cheap extra poll here saves an
 * entire status roundtrip between stopRecord and the summary fetch.
 */
const SESSION_ID_RESOLVE_RETRY_DELAY_MS = 500;

/**
 * Resolves the backend recording's session id for a live (non-dry-run)
 * paradigm session and feeds it into the session reducer. The runner mounts
 * right after start_eeg_recording resolves, so the first poll almost always
 * sees the recording; a transient IPC failure (or a poll racing the backend's
 * registration) gets exactly one short-delay retry — the reducer ignores
 * duplicate session_id_resolved, and the finish chain keeps its own pre-stop
 * status fetch as the last resort after that.
 */
export function useParadigmSessionId(
  dryRun: boolean,
  dispatch: (action: ParadigmSessionAction) => void,
) {
  useEffect(() => {
    if (dryRun) {
      return undefined;
    }

    let disposed = false;
    let retryHandle: number | null = null;
    let retried = false;

    const resolveSessionId = () => {
      getEegStatus()
        .then((status) => {
          if (disposed || !status.activeRecording) {
            return false;
          }
          dispatch({ type: 'session_id_resolved', sessionId: status.activeRecording.id });
          return true;
        })
        .catch(() => false)
        .then((resolved) => {
          if (!resolved && !disposed && !retried) {
            retried = true;
            retryHandle = window.setTimeout(resolveSessionId, SESSION_ID_RESOLVE_RETRY_DELAY_MS);
          }
        });
    };

    resolveSessionId();

    return () => {
      disposed = true;
      if (retryHandle !== null) {
        window.clearTimeout(retryHandle);
        retryHandle = null;
      }
    };
  }, [dryRun, dispatch]);
}
