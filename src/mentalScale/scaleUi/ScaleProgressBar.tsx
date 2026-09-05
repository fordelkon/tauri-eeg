import styles from './scaleUi.module.css';

export type ScaleProgressBarProps = {
  answered: number;
  total: number;
  /** Overrides the default "已答 x / N 题" readout. */
  label?: string;
};

/**
 * Top-of-dialog total progress: the answered/total readout next to a thin
 * bar (brand gradient while in progress, success green once complete).
 */
export default function ScaleProgressBar({ answered, total, label }: ScaleProgressBarProps) {
  const percent = total > 0
    ? Math.min(100, Math.round((answered / total) * 100))
    : 0;
  const isDone = total > 0 && answered >= total;

  return (
    <div className={`${styles.base} ${styles.progressBar}`}>
      <span className={styles.progressText}>{label ?? `已答 ${answered} / ${total} 题`}</span>
      <span className={styles.progressTrack}>
        <span
          className={`${styles.progressFill} ${isDone ? styles.progressFillDone : ''}`}
          style={{ width: `${percent}%` }}
        />
      </span>
    </div>
  );
}
