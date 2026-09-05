import { memo } from 'react';
import { formatCountdown } from './effectEvaluationFlow';
import styles from './EffectEvaluation.module.css';

type ConditionCountdownProps = {
  remainingSeconds: number;
  /** Total window length in seconds (durationMinutes * 60). */
  totalSeconds: number;
  windowNoun: string;
};

/**
 * Memoized countdown stage of the condition node: the only component on the
 * pipeline board whose props change on the 500ms wall-clock tick, so a tick
 * re-renders just this subtree inside the condition node's card. The finish
 * button's disabled state derives from the same remaining seconds but sits
 * outside — the digits themselves never render anywhere else.
 */
export const ConditionCountdown = memo(function ConditionCountdown({
  remainingSeconds, totalSeconds, windowNoun,
}: ConditionCountdownProps) {
  const isReached = remainingSeconds === 0;
  const progressPercent = totalSeconds > 0
    ? Math.min(100, Math.max(0, 100 - (remainingSeconds / totalSeconds) * 100))
    : 100;

  return (
    <div className={styles.countdownWrap}>
      <span
        role="status"
        className={`${styles.statusPill} ${isReached ? styles.statusDone : styles.statusActive}`}
      >
        {isReached ? `✓ ${windowNoun}时长已达成` : `● ${windowNoun}计时中`}
      </span>
      <span
        className={`${styles.countdownValue} ${isReached ? styles.countdownDone : ''}`}
        aria-label={`剩余时间 ${formatCountdown(remainingSeconds)}`}
      >
        {formatCountdown(remainingSeconds)}
      </span>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-label={`${windowNoun}计时进度`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPercent}
      >
        <div className={styles.progressBar} style={{ width: `${progressPercent}%` }} />
      </div>
      <p className={styles.panelHint} id="regulation-countdown-hint">
        {isReached
          ? `${windowNoun}时长已达成，可结束${windowNoun}进入复测。`
          : `未达最短时长：还剩 ${formatCountdown(remainingSeconds)}。计时结束后才能进入复测；确有特殊情况可跳过剩余时长（二次确认后记录标记）。`}
      </p>
    </div>
  );
});
