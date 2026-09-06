import styles from './scaleUi.module.css';

export type ScaleSectionHeaderProps = {
  /** Section name; the battery sections already embed their 第X部分 number. */
  title: string;
  /** Optional eyebrow line above the title (e.g. "第 1 部分"). */
  eyebrow?: string;
  /** Optional administration instruction under the title. */
  instruction?: string;
  answeredCount: number;
  totalCount: number;
};

/**
 * Section header of the battery dialog: title + "已答 n/m" readout + a thin
 * (4px, rounded) progress bar that flips to the success color when the
 * section is complete. The dialog wraps it in its own sticky container.
 */
export default function ScaleSectionHeader({
  title,
  eyebrow,
  instruction,
  answeredCount,
  totalCount,
}: ScaleSectionHeaderProps) {
  const percent = totalCount > 0
    ? Math.min(100, Math.round((answeredCount / totalCount) * 100))
    : 0;
  const isComplete = totalCount > 0 && answeredCount >= totalCount;

  return (
    <div className={`${styles.base} ${styles.sectionHeader}`}>
      {eyebrow ? <p className={styles.sectionEyebrow}>{eyebrow}</p> : null}
      <div className={styles.sectionTitleRow}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        <span className={`${styles.sectionCount} ${isComplete ? styles.sectionCountDone : ''}`}>
          {`已答 ${answeredCount} / ${totalCount}`}
        </span>
      </div>
      {instruction ? <p className={styles.sectionInstruction}>{instruction}</p> : null}
      <span className={styles.bar}>
        <span
          className={`${styles.barFill} ${isComplete ? styles.barFillDone : ''}`}
          style={{ transform: `scaleX(${percent / 100})` }}
        />
      </span>
    </div>
  );
}
