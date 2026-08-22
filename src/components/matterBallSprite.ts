// Pre-rendered glow sprites replace per-ball ctx.shadowBlur draws, which force
// a slow shadow re-rasterization per ball per frame. Each (color, radius,
// devicePixelRatio) combination is rasterized once and then blitted.

export type BallSprite = { canvas: HTMLCanvasElement; size: number };

const ballSpriteCache = new Map<string, BallSprite>();

export const getBallSprite = (color: string, radius: number): BallSprite => {
  const pixelRatio = window.devicePixelRatio || 1;
  const quantizedRadius = Math.round(radius * 2) / 2;
  const size = Math.ceil((quantizedRadius + 12) * 2);
  const key = `${color}|${quantizedRadius}|${pixelRatio}`;
  let sprite = ballSpriteCache.get(key);

  if (!sprite) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(size * pixelRatio);
    canvas.height = Math.ceil(size * pixelRatio);
    const spriteContext = canvas.getContext('2d');

    if (spriteContext) {
      spriteContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      spriteContext.shadowBlur = 8;
      spriteContext.shadowColor = 'rgba(63, 32, 36, 0.28)';
      spriteContext.fillStyle = color;
      spriteContext.beginPath();
      spriteContext.arc(size / 2, size / 2, quantizedRadius, 0, Math.PI * 2);
      spriteContext.fill();
    }

    sprite = { canvas, size };
    ballSpriteCache.set(key, sprite);
  }

  return sprite;
};
