import lottie, { type AnimationItem } from 'lottie-web';
import { useEffect, useRef } from 'react';
import { eegWaveHexLogoAnimation } from './eegWaveHexLogoAnimation';
import styles from './LottieEegLogo.module.css';

type LottieEegLogoProps = {
  className?: string;
  loop?: boolean;
  title?: string;
};

export default function LottieEegLogo({
  className,
  loop = true,
  title = 'EEG emotion regulation animated logo',
}: LottieEegLogoProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    const animation: AnimationItem = lottie.loadAnimation({
      animationData: eegWaveHexLogoAnimation,
      autoplay: true,
      container,
      loop,
      renderer: 'svg',
      rendererSettings: {
        progressiveLoad: true,
        preserveAspectRatio: 'xMidYMid meet',
      },
    });

    return () => {
      animation.destroy();
    };
  }, [loop]);

  return (
    <div className={`${styles.logo} ${className ?? ''}`} aria-label={title} role="img">
      <svg className={styles.mark} viewBox="0 0 360 360" aria-hidden="true">
        <g className={styles.hexSignal}>
          <path
            className={styles.outerHex}
            d="M180 48 294 114v132L180 312 66 246V114L180 48Z"
          />
          <path
            className={styles.innerHex}
            d="M180 95 253 138v84l-73 43-73-43v-84l73-43Z"
          />
        </g>
        <path
          className={styles.waveGhost}
          d="M10 180h26l9-5 8 5h17l8-12 9 24 10-31 10 38 12-28 11 9h13l9-16 11 31 12-36 12 33 10-12h16l8-8 8 8h18l9-14 10 22 10-26 11 18h23l8-5 8 5h23"
        />
        <path
          className={styles.wave}
          d="M10 180h26l9-5 8 5h17l8-12 9 24 10-31 10 38 12-28 11 9h13l9-16 11 31 12-36 12 33 10-12h16l8-8 8 8h18l9-14 10 22 10-26 11 18h23l8-5 8 5h23"
        />
        <circle className={styles.coreHalo} cx="180" cy="180" r="22" />
        <circle className={styles.core} cx="180" cy="180" r="10" />
        <circle className={styles.nodeRed} cx="180" cy="48" r="6.5" />
        <circle className={styles.nodeDark} cx="294" cy="114" r="6" />
        <circle className={styles.nodeRed} cx="180" cy="312" r="6" />
        <circle className={styles.nodeDark} cx="66" cy="246" r="6" />
      </svg>
      <div ref={containerRef} className={styles.animation} aria-hidden="true" />
    </div>
  );
}
