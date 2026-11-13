import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import { open } from '@tauri-apps/plugin-dialog';
import { useAuth } from '../auth/AuthContext';
import { describeFriendlyError } from '../ui/friendlyError';
import { associateBdf, listRuns, type ExperimentRun } from './api';

type Props = {
  run: ExperimentRun;
  userId: string;
  onSaved: (run: ExperimentRun) => void;
  disabled?: boolean;
};

export function BdfAttachment({ run, userId, onSaved, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (run.mode !== 'formal' || ['running', 'active'].includes(run.status)) return null;
  const planned = run.expectedRecordingName?.trim();
  const absolute = (p: string) => /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(p);
  const expectedPath = planned && absolute(planned) ? planned : undefined;
  const previousPath = run.bdfFiles.find(absolute) ?? expectedPath;
  const defaultPath = previousPath?.replace(/[^\\/]+$/, '');

  async function attach(select: boolean) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const selection = select
        ? await open({
            multiple: true,
            defaultPath,
            filters: [{ name: 'BioSemi BDF', extensions: ['bdf'] }],
          })
        : expectedPath;
      if (!selection) return;
      onSaved(
        await associateBdf(run.runId, userId, Array.isArray(selection) ? selection : [selection]),
      );
    } catch (failure) {
      setError(describeFriendlyError(failure, '关联 BDF'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="BDF 归档">
      <p style={{ overflowWrap: 'anywhere' }}>
        {run.bdfFiles.length
          ? '已关联 BDF：' + run.bdfFiles.join('、')
          : planned
            ? '预期 BDF：' + planned
            : '尚未关联 BDF 文件。'}
      </p>
      {!run.bdfFiles.length && <p>请先在 ActiView 正常停止保存。</p>}
      {expectedPath && !run.bdfFiles.length && (
        <Button disabled={busy || disabled} variant="contained" onClick={() => void attach(false)}>
          核验并关联本次 BDF
        </Button>
      )}
      <Button disabled={busy || disabled} variant="outlined" onClick={() => void attach(true)}>
        {run.bdfFiles.length ? '重新选择 BDF 文件' : '选择 BDF 文件'}
      </Button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

export function ResultBdfAttachment({ runId }: { runId: string }) {
  const { currentUser } = useAuth();
  const userId = currentUser?.id;
  const [run, setRun] = useState<ExperimentRun | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let current = true;
    setError('');
    void listRuns(userId)
      .then((items) => {
        if (!current) return;
        const item = items.find((item) => item.runId === runId);
        if (!item) throw new Error('未找到此账号的实验记录。');
        setRun(item);
      })
      .catch((reason) => {
        if (current) setError(describeFriendlyError(reason, '读取实验记录'));
      });
    return () => {
      current = false;
    };
  }, [attempt, runId, userId]);
  if (error)
    return (
      <p role="alert">
        {error} <Button onClick={() => setAttempt((value) => value + 1)}>重试</Button>
      </p>
    );
  return run?.runId === runId && userId && run.userId === userId ? (
    <BdfAttachment run={run} userId={userId} onSaved={setRun} />
  ) : null;
}
