import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import { open } from '@tauri-apps/plugin-dialog';
import { useAuth } from '../auth/AuthContext';
import { describeFriendlyError } from '../ui/friendlyError';
import { associateBdf, listRuns, type ExperimentRun } from './api';
import styles from './ExperimentArchive.module.css';

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
  const files = run.bdfFiles.length ? run.bdfFiles : planned ? [planned] : [];

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
    <section className={styles.attachment} aria-label="BDF 归档">
      <h3>{run.bdfFiles.length ? '已关联 BDF' : '关联 BDF 文件'}</h3>
      {!run.bdfFiles.length && <p>先在 ActiView 正常停止保存，再关联本次脑电文件。</p>}
      {files.length > 0 && (
        <ul className={styles.fileList}>
          {files.map((path) => (
            <li key={path}>
              {!run.bdfFiles.length && <span className={styles.expected}>预期文件</span>}
              {absolute(path) ? (
                <details className={styles.filePath}>
                  <summary title="展开完整路径">{path.split(/[\\/]/).pop()}</summary>
                  <code>{path}</code>
                </details>
              ) : (
                <code>{path}</code>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className={styles.fileActions}>
        {expectedPath && !run.bdfFiles.length && (
          <button
            type="button"
            className={styles.primary}
            disabled={busy || disabled}
            onClick={() => void attach(false)}
          >
            核验并关联本次 BDF
          </button>
        )}
        <button
          type="button"
          className={expectedPath || run.bdfFiles.length ? styles.tool : styles.primary}
          disabled={busy || disabled}
          onClick={() => void attach(true)}
        >
          {run.bdfFiles.length ? '重新选择 BDF 文件' : '选择 BDF 文件'}
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
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
