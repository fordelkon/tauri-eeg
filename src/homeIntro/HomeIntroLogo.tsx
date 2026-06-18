import { useEffect, useState } from 'react';
import LottieEegLogo from './LottieEegLogo';
import styles from './HomeIntroLogo.module.css';

type HomeIntroLogoProps = {
  onComplete?: () => void;
};

const INTRO_DURATION_MS = 2800;

export default function HomeIntroLogo({ onComplete }: HomeIntroLogoProps) {
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    const leaveTimer = window.setTimeout(() => {
      setIsLeaving(true);
    }, 2200);
    const completeTimer = window.setTimeout(() => {
      onComplete?.();
    }, INTRO_DURATION_MS);

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div
      className={`${styles.overlay} ${isLeaving ? styles.isLeaving : ''}`}
      aria-label="EEG emotion regulation logo animation"
      role="img"
    >
      <div className={styles.logoStage}>
        <LottieEegLogo className={styles.logoMark} loop />
      </div>
    </div>
  );
}
