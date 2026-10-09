import { useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { createRun } from '../experiment/api';
import { consumeRecordingConfirmation, readExperimentPreferences } from '../experiment/settings';
import ParadigmRunner from './ParadigmRunner';
import ParadigmSetupPanel, {
  type ParadigmStartRequest,
  type StartedParadigmRequest,
} from './ParadigmSetupPanel';
import { toLibraryErrorMessage } from './paradigmSessionKinds';

export default function ParadigmSessionPanel() {
  const { currentUser } = useAuth();
  const [run, setRun] = useState<StartedParadigmRequest | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const handleStartSession = async (request: ParadigmStartRequest) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const preferences = readExperimentPreferences();
      const started = await createRun({
        userId: currentUser?.id ?? null,
        subjectId: request.subjectId,
        flowKind: request.sessionKind,
        mode: request.dryRun ? 'rehearsal' : 'formal',
        externalRecordingConfirmed: preferences.externalRecordingConfirmed,
        expectedRecordingName: preferences.expectedRecordingName,
        materials: { sessionRunId: request.sessionRunId, queue: request.queue },
      });
      if (!request.dryRun) consumeRecordingConfirmation();
      setRun({ ...request, runId: started.runId });
    } catch (failure) {
      setError(toLibraryErrorMessage(failure));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  return run ? (
    <ParadigmRunner key={run.runId} request={run} onExitToSetup={() => setRun(null)} />
  ) : (
    <ParadigmSetupPanel
      onStartSession={(request) => void handleStartSession(request)}
      startPending={pending}
      startError={error}
    />
  );
}
