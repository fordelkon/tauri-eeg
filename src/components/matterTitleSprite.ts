/**
 * Title-letter sprite cache for the matter background. Title letters keep
 * per-frame motion (ball/pointer repulsion), so the whole title cannot be
 * cached as one bitmap. Instead each glyph — including its soft shadow,
 * which would otherwise force a shadow re-rasterization on every letter on
 * every frame — is rasterized once per (char, fontSize, dpr) and then
 * blitted with the letter's translate/rotate/squash transform.
 */

export type LetterSprite = { canvas: HTMLCanvasElement; height: number; width: number };

export const LETTER_FONT = (fontSize: number) => (
  `560 ${fontSize}px "Comic Sans MS", "Trebuchet MS", "Segoe UI", Arial, sans-serif`
);

export const defaultTitleFontSize = (width: number) => (
  width > 420 ? Math.min(42, Math.max(28, width * 0.045)) : Math.max(20, Math.min(25, width * 0.072))
);

const LETTER_SHADOW_BLUR = 1.5;
// Shadow sigma is blur / 2 = 0.75px, so 6px of padding safely contains the glow.
const LETTER_SPRITE_PADDING = 6;
const letterSpriteCache = new Map<string, LetterSprite>();

export const getLetterSprite = (char: string, fontSize: number): LetterSprite => {
  const pixelRatio = window.devicePixelRatio || 1;
  const key = `${char}|${fontSize}|${pixelRatio}`;
  let sprite = letterSpriteCache.get(key);

  if (!sprite) {
    const measureContext = document.createElement('canvas').getContext('2d');
    let textWidth = fontSize * 0.62;

    if (measureContext) {
      measureContext.font = LETTER_FONT(fontSize);
      textWidth = measureContext.measureText(char).width;
    }

    const width = Math.ceil(textWidth) + LETTER_SPRITE_PADDING * 2;
    // 1.6em of glyph box covers Comic Sans MS ascenders/descenders around the
    // 'middle' text baseline used when drawing.
    const height = Math.ceil(fontSize * 1.6) + LETTER_SPRITE_PADDING * 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * pixelRatio);
    canvas.height = Math.ceil(height * pixelRatio);
    const spriteContext = canvas.getContext('2d');

    if (spriteContext) {
      spriteContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      spriteContext.font = LETTER_FONT(fontSize);
      spriteContext.textAlign = 'center';
      spriteContext.textBaseline = 'middle';
      spriteContext.shadowBlur = LETTER_SHADOW_BLUR;
      spriteContext.shadowColor = 'rgba(255, 255, 255, 0.28)';
      spriteContext.fillStyle = '#ffffff';
      spriteContext.fillText(char, width / 2, height / 2);
    }

    sprite = { canvas, height, width };
    letterSpriteCache.set(key, sprite);
  }

  return sprite;
};
