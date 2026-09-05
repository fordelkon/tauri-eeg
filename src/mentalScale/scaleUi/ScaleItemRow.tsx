import type { ReactNode } from 'react';
import styles from './scaleUi.module.css';

export type ScaleItemRowProps = {
  /** Item badge: the question id (S1/P1/phq4_1) or a 1-based number. */
  badge?: string;
  prompt: string;
  /** The anchor control for this item (ScaleAnchorGroup). */
  children: ReactNode;
};

/**
 * One question of a scale dialog: the prompt on top (15-16px, weight 650,
 * line-height 1.6), the anchor control below. Flex/grid column layout keeps
 * long Chinese prompts from wrapping into the buttons.
 */
export default function ScaleItemRow({ badge, prompt, children }: ScaleItemRowProps) {
  return (
    <div className={`${styles.base} ${styles.itemRow}`}>
      <p className={styles.itemPrompt}>
        {badge ? <span className={styles.itemBadge}>{badge}</span> : null}
        <span>{prompt}</span>
      </p>
      {children}
    </div>
  );
}
