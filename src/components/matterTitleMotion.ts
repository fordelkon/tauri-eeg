import type { MatterPointerRef } from './matterBackground';
import type { LetterSprite } from './matterTitleSprite';
import { getLetterSprite } from './matterTitleSprite';

/**
 * Per-letter title motion for the matter background: each glyph reacts to
 * nearby balls and the pointer with a damped spring (drift, rotation,
 * squash), settling back to its layout position when nothing disturbs it.
 * Pure canvas-space math over the caller's letter array — no React, no
 * matter-js.
 */

export type TitleMotion = {
  baseX: number;
  baseY: number;
  char: string;
  fontSize: number;
  rotation: number;
  rotationVelocity: number;
  squash: number;
  squashVelocity: number;
  velocityX: number;
  velocityY: number;
  x: number;
  y: number;
};

export type TitleMotionField = {
  createLetterMotion: (char: string, baseX: number, baseY: number, fontSize: number) => TitleMotion;
  /** Blits the letters at their current transform (drawScene half). */
  draw: (context: CanvasRenderingContext2D) => void;
  /** Advances the springs one frame against the given ball positions. */
  update: (balls: readonly { position: { x: number; y: number } }[]) => void;
};

export function createTitleMotionField(options: {
  host: HTMLDivElement;
  letters: TitleMotion[];
  pointerRef: MatterPointerRef;
}): TitleMotionField {
  const { host, letters, pointerRef } = options;

  const createLetterMotion = (char: string, baseX: number, baseY: number, fontSize: number): TitleMotion => ({
    baseX,
    baseY,
    char,
    rotation: 0,
    rotationVelocity: 0,
    squash: 0,
    squashVelocity: 0,
    velocityX: 0,
    velocityY: 0,
    fontSize,
    x: 0,
    y: 0,
  });

  const update = (balls: readonly { position: { x: number; y: number } }[]) => {
    const pointerX = pointerRef.current.x * Math.max(host.clientWidth, 1);
    const pointerY = pointerRef.current.y * Math.max(host.clientHeight, 1);

    letters.forEach((letter) => {
      let targetX = 0;
      let targetY = 0;
      let targetRotation = 0;
      let targetSquash = 0;

      balls.forEach((ball) => {
        const deltaX = letter.baseX - ball.position.x;
        const deltaY = letter.baseY - ball.position.y;
        const distance = Math.max(Math.hypot(deltaX, deltaY), 1);
        const range = Math.max(letter.fontSize * 2.2, 58);

        if (distance > range) return;

        const falloff = (1 - distance / range) ** 2;

        targetX += (deltaX / distance) * falloff * 18;
        targetY += (deltaY / distance) * falloff * 13;
        targetRotation += (deltaX / range) * falloff * 0.42;
        targetSquash += falloff * 0.2;
      });

      if (pointerRef.current.active) {
        const deltaX = pointerX - letter.baseX;
        const deltaY = pointerY - letter.baseY;
        const distance = Math.max(Math.hypot(deltaX, deltaY), 1);
        const range = Math.max(letter.fontSize * 3.4, 95);

        if (distance < range) {
          const falloff = (1 - distance / range) ** 2;

          targetX += (deltaX / distance) * falloff * 10;
          targetY += (deltaY / distance) * falloff * 7;
          targetRotation += (deltaX / range) * falloff * 0.22;
          targetSquash += falloff * 0.1;
        }
      }

      targetSquash = Math.min(targetSquash, 0.22);
      letter.velocityX = (letter.velocityX + (targetX - letter.x) * 0.14) * 0.72;
      letter.velocityY = (letter.velocityY + (targetY - letter.y) * 0.14) * 0.72;
      letter.rotationVelocity = (letter.rotationVelocity + (targetRotation - letter.rotation) * 0.16) * 0.68;
      letter.squashVelocity = (letter.squashVelocity + (targetSquash - letter.squash) * 0.18) * 0.68;
      letter.x += letter.velocityX;
      letter.y += letter.velocityY;
      letter.rotation += letter.rotationVelocity;
      letter.squash += letter.squashVelocity;

      if (!pointerRef.current.active && Math.hypot(letter.x, letter.y) < 0.12) {
        letter.x = 0;
        letter.y = 0;
        letter.velocityX = 0;
        letter.velocityY = 0;
      }

      if (Math.abs(letter.rotation) < 0.003 && Math.abs(letter.rotationVelocity) < 0.003) {
        letter.rotation = 0;
        letter.rotationVelocity = 0;
      }

      if (Math.abs(letter.squash) < 0.004 && Math.abs(letter.squashVelocity) < 0.004) {
        letter.squash = 0;
        letter.squashVelocity = 0;
      }
    });
  };

  const draw = (context: CanvasRenderingContext2D) => {
    letters.forEach((letter) => {
      const sprite: LetterSprite = getLetterSprite(letter.char, letter.fontSize);

      context.save();
      context.translate(letter.baseX + letter.x, letter.baseY + letter.y);
      context.rotate(letter.rotation);
      context.scale(1 + letter.squash * 0.18, 1 - letter.squash * 0.12);
      context.drawImage(
        sprite.canvas,
        -sprite.width / 2,
        -sprite.height / 2,
        sprite.width,
        sprite.height,
      );
      context.restore();
    });
  };

  return { createLetterMotion, draw, update };
}
