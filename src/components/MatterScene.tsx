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

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const bounds = e.currentTarget.getBoundingClientRect();
    pointerRef.current = {
      active: true,
      x: (e.clientX - bounds.left) / bounds.width,
      y: (e.clientY - bounds.top) / bounds.height,
    };
  };

  const handlePointerLeave = () => {
    pointerRef.current.active = false;
  };

  return (
    <div
      ref={hostRef}
      className={className}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    />
  );
}
