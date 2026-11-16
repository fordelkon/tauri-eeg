import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useAuth } from '../auth/AuthContext';
import { BdfAttachment } from './BdfAttachment';
import { deleteRun, exportRun, listRuns, type ExperimentRun } from './api';
import { isTauriAvailable } from '../ui/tauriEnvironment';
import { describeFriendlyError } from '../ui/friendlyError';
import { useConfirmDialog } from '../ui/useConfirmDialog';
import { formatRunTimestamp, labelForEmotion } from '../pages/home/effectHistoryView';
import {
  EFFECT_METHOD_OPTIONS,
  labelForCondition,
} from '../pages/home/effectEvaluationFlow/constants';
import styles from './ExperimentArchive.module.css';

const statusLabels: Record<string, string> = {
  active: '进行中',
  running: '进行中',
  completed: '已完成',
  aborted: '已中止',
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
    <section className={styles.history} aria-label="实验记录">
      <header className={styles.listHeader}>
        <h2>实验记录</h2>
        <button
          type="button"
          className={styles.tool}
          disabled={busy || !isTauriAvailable()}
          onClick={() => void perform(refresh)}
        >
          <RefreshRoundedIcon fontSize="inherit" />
          刷新记录
        </button>
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {!runs.length && (
        <p className={styles.empty}>暂无实验记录。完成实验后，可在这里查看。</p>
      )}
      {runs.map((run) => (
        <details className={styles.record} key={run.runId}>
          <summary>
            <span className={styles.identity}>
              <strong>{run.subjectId || '未登记被试'}</strong>
              <span className={styles.meta}>
                {flowLabels[run.kind] ?? run.kind} · {run.mode === 'formal' ? '正式' : '排练'}
                {run.mode === 'formal' &&
                  !['running', 'active'].includes(run.status) &&
                  (run.bdfFiles.length ? ' · BDF 已关联' : ' · BDF 待关联')}
              </span>
              <time dateTime={run.startedAt} title={new Date(run.startedAt).toLocaleString()}>
                {formatRunTimestamp(run.startedAt)}
              </time>
            </span>
            <span className={styles.status} data-status={run.status}>
              {statusLabels[run.status] ?? run.status}
            </span>
            <ExpandMoreRoundedIcon aria-hidden="true" fontSize="small" />
          </summary>
          <div className={styles.detail}>
            <dl className={styles.facts}>
              {(run.emotion || run.condition) && (
                <>
                  <dt>实验条件</dt>
                  <dd>
                    {[
                      run.emotion && labelForEmotion(run.emotion),
                      run.condition && labelForCondition(run.condition),
                      run.condition === 'regulation' &&
                        run.method &&
                        (EFFECT_METHOD_OPTIONS.find((option) => option.value === run.method)
                          ?.label ??
                          run.method),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </dd>
                </>
              )}
            </dl>
            {userId && (
              <BdfAttachment
                run={run}
                userId={userId}
                disabled={busy}
                onSaved={(saved) =>
                  setRuns((items) =>
                    items.map((item) => (item.runId === saved.runId ? saved : item)),
                  )
                }
              />
            )}
            <div className={styles.actions}>
              <button
                disabled={busy}
                className={styles.tool}
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
                className={styles.remove}
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
            <p className={styles.runId}>
              记录编号 <code>{run.runId}</code>
            </p>
          </div>
        </details>
      ))}
      {runs.length > 0 && (
        <p className={styles.markerNote}>
          核对结束标记时，<b>61</b> 表示正常结束，<b>91</b> 表示中止。
        </p>
      )}
      {confirmDialogElement}
    </section>
  );
}
