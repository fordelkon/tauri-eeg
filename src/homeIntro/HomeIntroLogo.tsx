import { useEffect, useRef, useState } from 'react';
import LottieEegLogo from './LottieEegLogo';
import styles from './HomeIntroLogo.module.css';

type HomeIntroLogoProps = {
  onComplete?: () => void;
};

/** Snappier rhythm than the original 2200/2800: logo lands by ~860ms,
 *  holds for a beat, then exits. Reduced-motion users skip the wait. */
const INTRO_LEAVE_MS = 1900;
const INTRO_DURATION_MS = 2400;

export default function HomeIntroLogo({ onComplete }: HomeIntroLogoProps) {
  const [isLeaving, setIsLeaving] = useState(false);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const finish = () => {
      if (completedRef.current) {
        return;
      }

      completedRef.current = true;
      onCompleteRef.current?.();
    };

    const prefersReducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      // No splash wait for motion-sensitive users: unmount on next frame
      // so the home content is interactive immediately.
      const immediateTimer = window.setTimeout(finish, 0);

      return () => window.clearTimeout(immediateTimer);
    }

    const leaveTimer = window.setTimeout(() => {
      setIsLeaving(true);
    }, INTRO_LEAVE_MS);
    const completeTimer = window.setTimeout(finish, INTRO_DURATION_MS);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        finish();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(completeTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSkip = () => {
    if (completedRef.current) {
      return;
    }

    completedRef.current = true;
    onCompleteRef.current?.();
  };

  return (
    <div
      className={`${styles.overlay} ${isLeaving ? styles.isLeaving : ''}`}
      aria-label="开屏动画，按 Esc 或点击跳过可直接进入首页"
      aria-modal="true"
      role="dialog"
    >
      <div className={styles.logoStage}>
        <LottieEegLogo className={styles.logoMark} loop />
      </div>
      <button type="button" className={styles.skipButton} onClick={handleSkip}>
        跳过
      </button>
    </div>
  );
}
