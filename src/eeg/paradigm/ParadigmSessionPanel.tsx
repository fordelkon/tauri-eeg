import { useEffect, useState } from 'react';
import { useEegSession } from '../EegSessionContext';
import { useConfirmDialog } from '../../ui/useConfirmDialog';
import ParadigmRunner from './ParadigmRunner';
import ParadigmSetupPanel, { type ParadigmStartRequest } from './ParadigmSetupPanel';

/**
 * Composes the paradigm acquisition flow: the setup panel while idle, the
 * runner once the continuous recording with paradigm metadata has started.
 */
export default function ParadigmSessionPanel() {
  const eeg = useEegSession();
  const [run, setRun] = useState<ParadigmStartRequest | null>(null);
  const [pendingStart, setPendingStart] = useState<ParadigmStartRequest | null>(null);
  const { confirm, confirmDialogElement } = useConfirmDialog();

  // EegSessionContext.startRecord never rejects: it records failures via
  // errorMessage and success via recordStatus. Watch both to settle the start
  // request.
  useEffect(() => {
    if (!pendingStart) {
      return;
    }

    if (eeg.recordStatus === 'recording') {
      setRun(pendingStart);
      setPendingStart(null);
      return;
    }

    if (eeg.errorMessage) {
      setPendingStart(null);
    }
  }, [pendingStart, eeg.recordStatus, eeg.errorMessage]);

  const handleStartSession = (request: ParadigmStartRequest) => {
    // Dry-run skips the backend entirely: no recording, no files, no DB rows.
    if (request.dryRun) {
      setRun(request);
      return;
    }

    if (!eeg.canStartRecord) {
      // The gate has two distinct causes: with the lights all green a running
      // free recording is the actual blocker, so name it instead of claiming
      // the device is not ready. Alert-style confirm (single OK action).
      void confirm({
        title: '无法开始范式',
        description: eeg.recordStatus === 'recording'
          ? '已有 EEG 记录进行中,请先停止当前记录再开始范式。'
          : 'EEG 设备未就绪,请先启动设备并等待 EEG 与 Trigger 均已连接。',
        confirmText: '知道了',
        hideCancel: true,
      });
      return;
    }

    // The settle effect reads errorMessage as the failure signal, so a stale
    // error left over from an earlier attempt would cancel this start while
    // the backend begins recording anyway (orphaned run, Runner never
    // mounts). Clear it in the same batch as the request.
    eeg.resetError();
    setPendingStart(request);
    void eeg.startRecord({
      paradigm: {
        studySession: request.sessionKind,
        subjectId: request.subjectId,
        sessionRunId: request.sessionRunId,
      },
    });
  };

  if (run) {
    return (
      <ParadigmRunner
        key={run.sessionRunId}
        request={run}
        onExitToSetup={() => setRun(null)}
      />
    );
  }

  return (
    <>
      <ParadigmSetupPanel
        onStartSession={handleStartSession}
        startPending={pendingStart !== null}
        startError={pendingStart ? null : eeg.errorMessage}
      />
      {confirmDialogElement}
    </>
  );
}
