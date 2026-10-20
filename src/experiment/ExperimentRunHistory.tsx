import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useAuth } from '../auth/AuthContext';
import { associateBdf, deleteRun, exportRun, listRuns, type ExperimentRun } from './api';
import { isTauriAvailable } from '../ui/tauriEnvironment';
import { describeFriendlyError } from '../ui/friendlyError';
import { useConfirmDialog } from '../ui/useConfirmDialog';
import styles from '../pages/home/ExperimentSettings.module.css';

const statusLabels: Record<string, string> = {
  active: '进行中',
  running: '进行中',
  completed: '完成',
  aborted: '中止',
  interrupted: '中断',
  failed: '失败',
};
const flowLabels: Record<string, string> = {
  effect_evaluation: '效果评价',
  personal_calibration: '个人校准',
  held_out_generation: '独立诱发',
};
export default function ExperimentRunHistory() {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? null;
  const { confirm, confirmDialogElement } = useConfirmDialog();
  const [runs, setRuns] = useState<ExperimentRun[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setRuns(await listRuns(userId ?? undefined));
  };
  useEffect(() => {
    if (!isTauriAvailable() || !userId) return;
    let mounted = true;
    void listRuns(userId)
      .then((items) => {
        if (mounted) setRuns(items);
      })
      .catch((failure: unknown) => {
        if (mounted) setError(describeFriendlyError(failure, '读取实验记录'));
      });
    return () => {
      mounted = false;
    };
  }, [userId]);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError(describeFriendlyError(failure, '实验记录操作'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.section}>
      <h2>实验记录</h2>
      <button
        disabled={busy || !isTauriAvailable()}
        className={busy ? styles.isBusy : undefined}
        onClick={() => void perform(refresh)}
      >
        刷新记录
      </button>
      {error && (
        <p role="alert" className={styles.errorMessage}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.resultBanner}>
          {notice}
        </p>
      )}
      {!runs.length && (
        <p className={styles.muted}>完成排练或正式实验后，在此关联 BDF 并导出日志。</p>
      )}
      {runs.map((run) => (
        <details className={styles.history} key={run.runId}>
          <summary>
            {run.subjectId} · {flowLabels[run.kind] ?? run.kind} ·{' '}
            {run.mode === 'formal' ? '正式' : '排练'} · {statusLabels[run.status] ?? run.status} ·{' '}
            {new Date(run.startedAt).toLocaleString()}
            <br />
            {run.runId}
          </summary>
          <p>{[run.emotion, run.condition, run.method].filter(Boolean).join(' · ')}</p>
          <p>BDF：{run.bdfFiles.length ? run.bdfFiles.join('、') : '尚未关联'}</p>
          <div className={styles.row}>
            <button
              disabled={
                busy || run.mode !== 'formal' || run.status === 'running' || run.status === 'active'
              }
              className={busy ? styles.isBusy : undefined}
              onClick={() =>
                void perform(async () => {
                  const files = await open({
                    multiple: true,
                    filters: [{ name: 'BioSemi BDF', extensions: ['bdf'] }],
                  });
                  if (!files) return;
                  await associateBdf(run.runId, typeof files === 'string' ? [files] : files);
                  await refresh();
                })
              }
            >
              关联 BDF 文件
            </button>
            <button
              disabled={busy}
              className={busy ? styles.isBusy : undefined}
              onClick={() =>
                void perform(async () => {
                  const folder = await open({
                    directory: true,
                    multiple: false,
                    title: '选择实验日志导出目录',
                  });
                  if (typeof folder !== 'string') return;
                  const result = await exportRun(run.runId, folder);
                  setNotice(`实验日志已导出到 ${result.path}`);
                })
              }
            >
              导出实验日志
            </button>
            <button
              disabled={busy || run.status === 'running' || run.status === 'active'}
              className={`${styles.deleteBtn} ${busy ? styles.isBusy : ''}`}
              onClick={() =>
                void perform(async () => {
                  const ok = await confirm({
                    title: '删除实验记录',
                    description: `确定要删除被试 ${run.subjectId} 的本次实验记录（${run.runId}）吗？关联的事件记录和试次数据将被彻底删除，此操作不可逆。`,
                    confirmText: '删除',
                    cancelText: '取消',
                    destructive: true,
                  });
                  if (!ok) return;
                  await deleteRun(run.runId, userId ?? undefined);
                  setNotice(`已删除实验记录：${run.runId}`);
                  await refresh();
                })
              }
            >
              删除记录
            </button>
          </div>
        </details>
      ))}
      {confirmDialogElement}
    </section>
  );
}
