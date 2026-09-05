import { useCallback, type Dispatch } from 'react';
import type { UserProfile } from '../auth/types';
import { startEegRecording, stopEegRecording } from './eegApi';
import { describeEegError } from './eegErrorMessages';
import type { eegSessionReducer } from './eegSessionState';
import type { EegRecordingSession, StartEegRecordingRequest } from './types';
import type { ParadigmInfo } from './paradigm/types';

type EegSessionAction = Parameters<typeof eegSessionReducer>[1];

const SIGN_IN_REQUIRED_ERROR = 'Sign in before recording EEG.';

/**
 * Recording command slice of the EEG session provider: start (free or
 * paradigm-tagged), pause, resume, and stop-and-save. Boolean returns let
 * callers (agent actions especially) tell "the command ran" from "the state
 * machine silently refused"; the mapped failure copy lands in errorMessage
 * either way.
 */
export function useEegRecordingCommands(options: {
  canStartRecordNow: boolean;
  canPauseRecordNow: boolean;
  canResumeRecordNow: boolean;
  canStopRecordNow: boolean;
  currentUser: UserProfile | null;
  dispatchSession: Dispatch<EegSessionAction>;
  setLastRecording: (session: EegRecordingSession) => void;
}) {
  const {
    canStartRecordNow,
    canPauseRecordNow,
    canResumeRecordNow,
    canStopRecordNow,
    currentUser,
    dispatchSession,
    setLastRecording,
  } = options;

  const startRecord = useCallback(async (options?: { paradigm?: ParadigmInfo }): Promise<boolean> => {
    if (!canStartRecordNow) {
      return false;
    }

    if (!currentUser) {
      dispatchSession({
        type: 'start_record_failed',
        message: describeEegError(SIGN_IN_REQUIRED_ERROR),
      });
      return false;
    }

    const request: StartEegRecordingRequest = {
      userId: currentUser.id,
      username: currentUser.username,
    };
    // Only include the paradigm key for paradigm runs so free recordings keep
    // the exact legacy payload.
    if (options?.paradigm) {
      request.paradigm = options.paradigm;
    }

    try {
      await startEegRecording(request);
      dispatchSession({ type: 'start_record' });
      return true;
    } catch (error) {
      dispatchSession({
        type: 'start_record_failed',
        message: describeEegError(error, 'Failed to start EEG recording.'),
      });
      return false;
    }
  }, [canStartRecordNow, currentUser, dispatchSession]);

  const pauseRecord = useCallback((): boolean => {
    if (!canPauseRecordNow) {
      return false;
    }

    dispatchSession({ type: 'pause_record' });
    return true;
  }, [canPauseRecordNow, dispatchSession]);

  const resumeRecord = useCallback((): boolean => {
    if (!canResumeRecordNow) {
      return false;
    }

    dispatchSession({ type: 'resume_record' });
    return true;
  }, [canResumeRecordNow, dispatchSession]);

  const stopRecord = useCallback(async (): Promise<boolean> => {
    if (!canStopRecordNow) {
      return false;
    }

    try {
      const session = await stopEegRecording();
      setLastRecording(session);
      dispatchSession({ type: 'stop_record' });
      return true;
    } catch (error) {
      dispatchSession({
        type: 'stop_record_failed',
        message: describeEegError(error, 'Failed to stop EEG recording.'),
      });
      return false;
    }
  }, [canStopRecordNow, dispatchSession, setLastRecording]);

  return { pauseRecord, resumeRecord, startRecord, stopRecord };
}
