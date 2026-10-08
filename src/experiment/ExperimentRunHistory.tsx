import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useAuth } from '../auth/AuthContext';
import { associateBdf, exportRun, listRuns, type ExperimentRun } from './api';
import { isTauriAvailable } from '../ui/tauriEnvironment';
import styles from '../pages/home/ExperimentSettings.module.css';

const statusLabels: Record<string, string> = { active: '进行中', running: '进行中', completed: '完成', aborted: '中止', interrupted: '中断', failed: '失败' };
export default function ExperimentRunHistory() {
  const { currentUser } = useAuth();
  const [runs, setRuns] = useState<ExperimentRun[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setRuns(await listRuns(currentUser?.id)); };
  useEffect(() => {
    if (!isTauriAvailable() || !currentUser) return;
    let mounted = true;
    void listRuns(currentUser.id).then((items) => { if (mounted) setRuns(items); })
      .catch((failure: unknown) => { if (mounted) setError(String(failure)); });
    return () => { mounted = false; };
  }, [currentUser?.id]);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  };
  return <section className={styles.section}>
    <h2>实验记录</h2>
    <button disabled={busy || !isTauriAvailable()} onClick={() => void perform(refresh)}>刷新记录</button>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!runs.length && <p className={styles.muted}>完成排练或正式实验后，在此关联 BDF 并导出日志。</p>}
    {runs.map((run) => <details className={styles.history} key={run.runId}>
      <summary>{run.subjectId} · {run.mode === 'formal' ? '正式' : '排练'} · {statusLabels[run.status] ?? run.status} · {new Date(run.startedAt).toLocaleString()}<br />{run.runId}</summary>
      <p>{run.kind} · {run.emotion} · {run.condition} · {run.method}</p>
      <p>BDF：{run.bdfFiles.length ? run.bdfFiles.join('、') : '尚未关联'}</p>
      <div className={styles.row}>
        <button disabled={busy || run.mode !== 'formal' || run.status === 'running' || run.status === 'active'} onClick={() => void perform(async () => {
          const files = await open({ multiple: true, filters: [{ name: 'BioSemi BDF', extensions: ['bdf'] }] });
          if (!files) return;
          await associateBdf(run.runId, typeof files === 'string' ? [files] : files); await refresh();
        })}>关联 BDF 文件</button>
        <button disabled={busy} onClick={() => void perform(async () => {
          const folder = await open({ directory: true, multiple: false, title: '选择实验日志导出目录' });
          if (typeof folder !== 'string') return;
          const result = await exportRun(run.runId, folder); setNotice(`实验日志已导出到 ${result.path}`);
        })}>导出实验日志</button>
      </div>
    </details>)}
  </section>;
}
