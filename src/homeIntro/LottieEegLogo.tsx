import type { AnimationItem } from 'lottie-web/build/player/lottie_light';
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
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    let cancelled = false;
    let animation: AnimationItem | null = null;
    let detachVisibilitySync: (() => void) | null = null;

    // Load the light player lazily so the lottie runtime stays off every
    // route's critical path; it is only fetched once a logo actually mounts.
    void import('lottie-web/build/player/lottie_light').then(({ default: lottie }) => {
      if (cancelled || !containerRef.current) {
        return;
      }

      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      animation = lottie.loadAnimation({
        animationData: eegWaveHexLogoAnimation,
        autoplay: !prefersReducedMotion,
        container,
        loop,
        renderer: 'svg',
        rendererSettings: {
          progressiveLoad: true,
          preserveAspectRatio: 'xMidYMid meet',
        },
      });

      let isVisible = true;
      let isPageVisible = !document.hidden;
      let playing = !prefersReducedMotion;

      const syncPausedState = () => {
        // Pause the lottie player and the CSS keyframe animations together so a
        // hidden/offscreen logo stops both its JS and compositor work.
        rootRef.current?.toggleAttribute('data-paused', !playing);
      };

      syncPausedState();

      const syncPlayback = () => {
        const shouldPlay = !prefersReducedMotion && isVisible && isPageVisible;
        if (shouldPlay === playing) return;
        playing = shouldPlay;
        if (shouldPlay) {
          animation?.play();
        } else {
          animation?.pause();
        }
        syncPausedState();
      };

      const handleVisibilityChange = () => {
        isPageVisible = !document.hidden;
        syncPlayback();
      };

      const intersectionObserver = new IntersectionObserver(([entry]) => {
        isVisible = entry.isIntersecting;
        syncPlayback();
      });
      intersectionObserver.observe(container);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      detachVisibilitySync = () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        intersectionObserver.disconnect();
      };
    });

    return () => {
      cancelled = true;
      detachVisibilitySync?.();
      animation?.destroy();
    };
  }, [loop]);

  return (
    <div ref={rootRef} className={`${styles.logo} ${className ?? ''}`} aria-label={title} role="img">
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
