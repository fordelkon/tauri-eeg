import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import {
  deleteScaleRecord,
  listEffectHistory,
  type EffectHistoryEntryView,
} from '../../mentalScale/scaleRecordsApi';
import { describeFriendlyError } from '../../ui/friendlyError';
import {
  filterHistoryEntries,
  formatMeanImprovementRate,
  formatRunTimestamp,
  groupHistoryBySubject,
  labelForEmotion,
  labelForHistoryCondition,
  outcomeForEntry,
  type HistoryOutcome,
} from './effectHistoryView';
import { labelForDimension } from './effectEvaluationFlow';
import styles from './EffectEvaluation.module.css';

const OUTCOME_CLASS: Record<HistoryOutcome, string> = {
  达标: styles.outcomePass,
  未达标: styles.outcomeFail,
  无法判定: styles.outcomeUnknown,
};

/** Dimension detail table shared by every expanded history row. */
function RunDetailTable({ entry }: { entry: EffectHistoryEntryView }) {
  return (
    <div className={styles.historyDetail}>
      <div className={styles.configSummary}>
        <span className={styles.configChip}>基线 {formatRunTimestamp(entry.baselineCreatedAt)}</span>
        <span className={styles.configChip}>复测 {formatRunTimestamp(entry.postCreatedAt)}</span>
        <span className={styles.configChip}>
          时长 {entry.durationMinutes === null ? '—' : `${entry.durationMinutes} 分钟`}
        </span>
        {entry.regulationSkipped ? (
          <span className={styles.configChip}>已跳过剩余时长</span>
        ) : null}
        {/* R4/F2: the persisted neural-data link survives restarts. */}
        {entry.eegSessionId ? (
          <span className={styles.configChip} title={entry.eegSessionId}>
            EEG 会话 {`${entry.eegSessionId.slice(0, 8)}…`}
          </span>
        ) : null}
        {/* R4/F1: flag pairs whose mean still covers unmarked stored keys. */}
        {!entry.measuredOnly ? (
          <span className={styles.configChip}>旧记录口径（未标注实测维度）</span>
        ) : null}
      </div>

      {entry.dimensions.length > 0 ? (
        <div className={styles.tableFrame}>
          <table className={styles.dimensionTable}>
            <thead>
              <tr>
                <th>维度</th>
                <th>基线</th>
                <th>调控后</th>
                <th>改善率</th>
              </tr>
            </thead>
            <tbody>
              {entry.dimensions.map((dimension) => (
                <tr key={dimension.dimension}>
                  <td>{labelForDimension(dimension.dimension)}</td>
                  <td>{Math.round(dimension.baseline)}</td>
                  <td>{Math.round(dimension.post)}</td>
                  <td className={dimension.improvementRate >= 0
                    ? `${styles.rateCell} ${styles.isPositive}`
                    : `${styles.rateCell} ${styles.isNegative}`}
                  >
                    {formatMeanImprovementRate(dimension.improvementRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.panelHint}>该次评价没有可对比的维度（维度缺失或基线为 0）。</p>
      )}
    </div>
  );
}

/**
 * History review tab: every completed baseline/post run grouped per subject
 * (newest first), with a subject filter and expandable per-run details.
 * Grouping/filtering rules live in the pure `effectHistoryView` module.
 */
export default function EffectHistoryPanel() {
  const [entries, setEntries] = useState<EffectHistoryEntryView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [subjectQuery, setSubjectQuery] = useState('');
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EffectHistoryEntryView | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      setEntries(await listEffectHistory());
    } catch (error) {
      setLoadError(describeFriendlyError(error, '加载历史评价记录'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // The panel mounts lazily (history tab only), so loading on mount is fine.
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const filteredEntries = useMemo(
    () => filterHistoryEntries(entries ?? [], subjectQuery),
    [entries, subjectQuery],
  );
  const groups = useMemo(() => groupHistoryBySubject(filteredEntries), [filteredEntries]);

  const toggleRow = (postId: string) => {
    setExpandedPostId((current) => (current === postId ? null : postId));
  };

  // A history entry is derived from its baseline+post record pair, so
  // deleting a run removes BOTH legs; the pair disappears as one run.
  const confirmDelete = async () => {
    const entry = pendingDelete;
    if (!entry || isDeleting) {
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteScaleRecord(entry.postRecordId);
      await deleteScaleRecord(entry.baselineRecordId);
      setExpandedPostId((current) => (current === entry.postRecordId ? null : current));
      setPendingDelete(null);
      await loadHistory();
    } catch (error) {
      setDeleteError(describeFriendlyError(error, '删除历史评价记录'));
    } finally {
      setIsDeleting(false);
    }
  };

  if (loadError) {
    return (
      <section className={styles.panel} aria-label="历史评价记录">
        <h2 className={styles.panelTitle}>历史记录</h2>
        <Alert severity="warning">{loadError}</Alert>
        <div className={styles.actionsRow}>
          <Button variant="outlined" onClick={() => void loadHistory()}>
            重试加载
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-label="历史评价记录">
      <div className={styles.historyToolbar}>
        <h2 className={styles.panelTitle}>历史记录</h2>
        <div className={styles.historyToolbarControls}>
          <input
            className={`${styles.textInput} ${styles.historySearch}`}
            value={subjectQuery}
            onChange={(event) => setSubjectQuery(event.currentTarget.value)}
            placeholder="按被试 ID 过滤"
            aria-label="按被试 ID 过滤"
            autoComplete="off"
          />
          <Button variant="outlined" disabled={isLoading} onClick={() => void loadHistory()}>
            刷新
          </Button>
        </div>
      </div>

      {deleteError ? (
        <Alert severity="warning" onClose={() => setDeleteError(null)}>
          {deleteError}
        </Alert>
      ) : null}

      {entries === null ? (
        <p className={`${styles.panelHint} ${styles.loadingHint}`}>{isLoading ? '正在加载历史评价…' : ''}</p>
      ) : filteredEntries.length === 0 ? (
        <div className={styles.emptyState}>
          {entries.length === 0
            ? '还没有完成的评价：完整走完一次 基线 → 调控 → 调控后 流程后，这里会列出每次的结果。'
            : '没有匹配该被试 ID 的评价记录。'}
        </div>
      ) : (
        <div className={styles.historyGroups}>
          {groups.map((group) => (
            <div key={group.subjectId || '__unbound__'} className={styles.historyGroup}>
              <div className={styles.historyGroupHead}>
                被试 {group.subjectId || '未绑定'}
                <span className={styles.historyGroupCount}>{group.entries.length} 次评价</span>
              </div>

              <div className={styles.historyRows}>
                {group.entries.map((entry) => {
                  const outcome = outcomeForEntry(entry);
                  const isExpanded = expandedPostId === entry.postRecordId;

                  return (
                    <div key={entry.postRecordId} className={styles.historyRowWrap}>
                      <div className={styles.historyRowLine}>
                      <button
                        type="button"
                        className={styles.historyRow}
                        aria-expanded={isExpanded}
                        onClick={() => toggleRow(entry.postRecordId)}
                      >
                        <span className={styles.historyRowTime}>
                          {formatRunTimestamp(entry.postCreatedAt)}
                        </span>
                        <span className={styles.configChip}>情绪 {labelForEmotion(entry.emotion)}</span>
                        {/* R7, feedback-003 P2-1: the condition chip makes
                            natural-recovery / regulation / legacy runs
                            distinguishable at a glance while checking that
                            both conditions were completed. */}
                        <span className={styles.configChip}>
                          {labelForHistoryCondition(entry.condition)}
                        </span>
                        <span className={styles.historyRowRate}>
                          改善率 {formatMeanImprovementRate(entry.meanImprovementRate)}
                        </span>
                        <span className={`${styles.outcomeChip} ${OUTCOME_CLASS[outcome]}`}>
                          {outcome}
                        </span>
                      </button>

                        <IconButton
                          type="button"
                          className={styles.historyDeleteButton}
                          aria-label={`删除 ${formatRunTimestamp(entry.postCreatedAt)} 的评价记录`}
                          title="删除这条评价记录"
                          disabled={isDeleting}
                          onClick={() => setPendingDelete(entry)}
                          size="small"
                        >
                          <DeleteOutlineRounded fontSize="small" />
                        </IconButton>
                      </div>

                      <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                        <RunDetailTable entry={entry} />
                      </Collapse>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={pendingDelete !== null}
        onClose={() => {
          if (!isDeleting) {
            setPendingDelete(null);
          }
        }}
        aria-labelledby="history-delete-title"
      >
        <DialogTitle id="history-delete-title">删除这条历史评价?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            将同时删除该次评价对应的基线与复测量表记录，删除后无法恢复。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)} disabled={isDeleting}>
            取消
          </Button>
          <Button color="error" disabled={isDeleting} onClick={() => void confirmDelete()}>
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </section>
  );
}
