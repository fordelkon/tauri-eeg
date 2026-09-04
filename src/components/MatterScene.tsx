import { useEffect, useRef } from 'react';
import { createMatterBackground } from './matterBackground';

export { getBallCountConfig } from './matterBackground';

type Props = {
  className?: string;
  initialBallCount?: number;
  maxBallCount?: number;
  scale?: number;
  title?: string;
};

export default function MatterScene({
  className = '',
  initialBallCount,
  maxBallCount,
  scale = 1,
  title = 'EEG Ecosystem',
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const hostBoundsRef = useRef<DOMRect | null>(null);
  const pointerRef = useRef({ active: false, x: 0.5, y: 0.5 });
  const titleRef = useRef(title);
  const relayoutTitleRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    titleRef.current = title;
    relayoutTitleRef.current?.();
  }, [title]);

  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return undefined;
    }

    const background = createMatterBackground({
      getTitle: () => titleRef.current,
      host,
      initialBallCount,
      maxBallCount,
      pointerRef,
      scale,
    });

    relayoutTitleRef.current = background.relayoutTitle;

    return () => {
      relayoutTitleRef.current = null;
      background.destroy();
    };
  }, [initialBallCount, maxBallCount, scale]);

  // getBoundingClientRect inside the pointermove handler forces a synchronous
  // layout on every pointer event over the scene. The panel rect is cached
  // instead and refreshed only when it can actually change: on pointer entry
  // and window resize (the scene panel itself never scrolls).
  useEffect(() => {
    const refreshBounds = () => {
      hostBoundsRef.current = hostRef.current?.getBoundingClientRect() ?? null;
    };

    window.addEventListener('resize', refreshBounds, { passive: true });
    return () => window.removeEventListener('resize', refreshBounds);
  }, []);

  const handlePointerEnter = () => {
    hostBoundsRef.current = hostRef.current?.getBoundingClientRect() ?? null;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // pointerenter populates the cache first; measure live only if it is
    // somehow missing (e.g. the very first event before enter ran).
    const bounds = hostBoundsRef.current ?? (hostRef.current?.getBoundingClientRect() ?? null);

    if (bounds) {
      hostBoundsRef.current = bounds;
      pointerRef.current = {
        active: true,
        x: (e.clientX - bounds.left) / bounds.width,
        y: (e.clientY - bounds.top) / bounds.height,
      };
    }
  };

  const handlePointerLeave = () => {
    pointerRef.current.active = false;
  };

  return (
    <div
      ref={hostRef}
      className={className}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    />
  );
}
