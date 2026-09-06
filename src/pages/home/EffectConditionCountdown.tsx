import { memo, useEffect, useRef, useState } from 'react';
import {
  formatCountdown,
  remainingRegulationSeconds,
  type EffectEvaluationFlowState,
} from './effectEvaluationFlow';
import styles from './EffectEvaluation.module.css';

type ConditionCountdownProps = {
  /** Live flow state; the clock reads the window start + duration only. */
  state: EffectEvaluationFlowState;
  windowNoun: string;
  /** Fired once when the countdown first reads 0 — the page's finish-gate flip. */
  onElapsed: () => void;
};

/**
 * Self-contained countdown clock of the condition node: the ONLY component on
 * the effect-evaluation page that owns the 500ms wall-clock interval. It
 * reads the clock itself, ticks its own digits, stops polling once the window
 * elapsed (the display is static from there on), and reports expiry upward
 * exactly once so the page can unlock the finish button.
 *
 * Render-cost contract: no parent re-renders on a tick — the page consumes
 * only the one-shot `onElapsed` fact, and because the remaining seconds are
 * integers, identical consecutive readings bail out of the state update, so
 * this subtree re-renders at 1Hz rather than at the 500ms poll cadence. The
 * countdown math stays in the pure `remainingRegulationSeconds` helper; the
 * interval is cleaned up on unmount and StrictMode double-mount safe.
 */
export const ConditionCountdown = memo(function ConditionCountdown({
  state, windowNoun, onElapsed,
}: ConditionCountdownProps) {
  const [remainingSeconds, setRemainingSeconds] = useState(
    () => remainingRegulationSeconds(state, Date.now()) ?? 0,
  );
  const hasElapsed = remainingSeconds === 0;

  // The expiry report is one-shot per mount; the ref keeps the callback out
  // of the effect deps so an unstable handler cannot re-arm the report.
  const onElapsedRef = useRef(onElapsed);
  useEffect(() => {
    onElapsedRef.current = onElapsed;
  }, [onElapsed]);

  const hasReportedElapsedRef = useRef(false);
  useEffect(() => {
    if (!hasElapsed || hasReportedElapsedRef.current) {
      return;
    }

    hasReportedElapsedRef.current = true;
    onElapsedRef.current();
  }, [hasElapsed]);

  // The wall-clock tick lives here and nowhere else on the page: polled only
  // while the window runs and has not yet elapsed, cleaned up on unmount.
  useEffect(() => {
    if (hasElapsed) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      const next = remainingRegulationSeconds(state, Date.now()) ?? 0;
      // Identical integer seconds bail out of the state update (no render).
      setRemainingSeconds(next);
    }, 500);

    return () => window.clearInterval(intervalId);
  }, [hasElapsed, state.durationMinutes, state.regulationStartedAtMs]);

  const totalSeconds = state.durationMinutes * 60;
  const progressPercent = totalSeconds > 0
    ? Math.min(100, Math.max(0, 100 - (remainingSeconds / totalSeconds) * 100))
    : 100;

  return (
    <div className={styles.countdownWrap}>
      <span
        role="status"
        className={`${styles.statusPill} ${hasElapsed ? styles.statusDone : styles.statusActive}`}
      >
        {hasElapsed ? `✓ ${windowNoun}时长已达成` : `● ${windowNoun}计时中`}
      </span>
      <span
        className={`${styles.countdownValue} ${hasElapsed ? styles.countdownDone : ''}`}
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
        <div className={styles.progressBar} style={{ transform: `scaleX(${progressPercent / 100})` }} />
      </div>
      <p className={styles.panelHint} id="regulation-countdown-hint">
        {hasElapsed
          ? `${windowNoun}时长已达成，可结束${windowNoun}进入复测。`
          : `未达最短时长：还剩 ${formatCountdown(remainingSeconds)}。计时结束后才能进入复测；确有特殊情况可跳过剩余时长（二次确认后记录标记）。`}
      </p>
    </div>
  );
});
