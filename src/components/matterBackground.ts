import { Bodies, Body, Composite, Engine, Events, Render } from 'matter-js';
import { getBallSprite } from './matterBallSprite';

type SceneBody = Body & {
  plugin: {
    birthTime?: number;
    color: string;
    kind: 'ball';
    lifetime?: number;
    radius?: number;
    ringColor?: string;
  };
};

type PopParticle = {
  age: number;
  color: string;
  duration: number;
  radius: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
};

type TitleMotion = {
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

export type MatterPointerState = { active: boolean; x: number; y: number };
export type MatterPointerRef = { current: MatterPointerState };

export type MatterBackgroundOptions = {
  getTitle: () => string;
  host: HTMLDivElement;
  initialBallCount?: number;
  maxBallCount?: number;
  pointerRef: MatterPointerRef;
  scale?: number;
  titleFontSize?: (width: number) => number;
};

export type MatterBackground = {
  destroy: () => void;
  relayoutTitle: () => void;
};

// Frame cadence: rAF runs at display refresh rate, but frames are throttled to
// ~30fps to halve canvas rasterization work. The loop steps the engine and then
// calls the custom drawScene directly; Matter's Render.world/Render.run are
// never used because every body is render:{visible:false} and drawScene
// repaints the full canvas each frame.
const FRAME_INTERVAL_MS = 1000 / 30;
// Physics still advances in fixed 60Hz steps (two substeps per rendered frame)
// so ball motion, spawn cadence and lifetimes stay identical to the previous
// Runner-based 60fps setup.
const PHYSICS_STEP_MS = 1000 / 60;
const PHYSICS_STEPS_PER_FRAME = 2;

const BALL_PALETTE = [
  { color: '#ff3d1f', ringColor: '#7edfff' },
  { color: '#ffc321', ringColor: '#47c8ff' },
  { color: '#a238ff', ringColor: '#7cf0ff' },
  { color: '#c3e9f1', ringColor: '#1b1b1d' },
  { color: '#d36a20', ringColor: '#8ee8ff' },
] as const;

const defaultTitleFontSize = (width: number) => (
  width > 420 ? Math.min(42, Math.max(28, width * 0.045)) : Math.max(20, Math.min(25, width * 0.072))
);

const LETTER_FONT = (fontSize: number) => (
  `560 ${fontSize}px "Comic Sans MS", "Trebuchet MS", "Segoe UI", Arial, sans-serif`
);

// Title letters keep per-frame motion (ball/pointer repulsion), so the whole
// title cannot be cached as one bitmap. Instead each glyph — including its soft
// shadow, which would otherwise force a shadow re-rasterization on every
// letter on every frame — is rasterized once per (char, fontSize, dpr) and then
// blitted with the letter's translate/rotate/squash transform.
type LetterSprite = { canvas: HTMLCanvasElement; height: number; width: number };

const LETTER_SHADOW_BLUR = 1.5;
// Shadow sigma is blur / 2 = 0.75px, so 6px of padding safely contains the glow.
const LETTER_SPRITE_PADDING = 6;
const letterSpriteCache = new Map<string, LetterSprite>();

const getLetterSprite = (char: string, fontSize: number): LetterSprite => {
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

export const getBallCountConfig = (
  width: number,
  initialBallCount?: number,
  maxBallCount?: number,
) => {
  const fallbackInitial = width > 420 ? 5 : 3;
  const fallbackMax = width > 420 ? 10 : 6;
  const initial = Math.max(0, Math.floor(initialBallCount ?? fallbackInitial));
  const max = Math.max(initial, Math.floor(maxBallCount ?? fallbackMax));

  return { initial, max };
};

export function createMatterBackground({
  getTitle,
  host,
  initialBallCount,
  maxBallCount,
  pointerRef,
  scale = 1,
  titleFontSize = defaultTitleFontSize,
}: MatterBackgroundOptions): MatterBackground {
  const noop = () => {};

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return { destroy: noop, relayoutTitle: noop };
  }

  const engine = Engine.create();
  engine.gravity.y = 0.58;

  const render = Render.create({
    element: host,
    engine,
    options: {
      background: 'transparent',
      height: host.clientHeight,
      pixelRatio: window.devicePixelRatio,
      width: host.clientWidth,
      wireframes: false,
    },
  });

  const balls: SceneBody[] = [];
  const particles: PopParticle[] = [];
  const titleLetters: TitleMotion[] = [];
  let titleBounds = {
    height: 38,
    width: 220,
  };
  let worldCenter = { x: 0, y: 0 };
  let worldRadius = 0;
  let lastSpawnAt = 0;
  let lastParticleTick = performance.now();

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

  let titleBarrier: Body | null = null;

  const layoutTitle = () => {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    const centerX = width / 2;
    const centerY = height / 2;
    const currentTitle = getTitle();
    const resolvedFontSize = titleFontSize(width);

    render.context.font = LETTER_FONT(resolvedFontSize);
    titleBounds = {
      height: resolvedFontSize * 1.28,
      width: Math.max(render.context.measureText(currentTitle).width, resolvedFontSize * Math.min(currentTitle.length, 11) * 0.62),
    };

    const letterGap = resolvedFontSize * 0.025;
    const measuredLetters = [...currentTitle].map((char) => (
      char === ' ' ? resolvedFontSize * 0.4 : render.context.measureText(char).width
    ));
    const measuredTitleWidth = measuredLetters.reduce(
      (total, letterWidth) => total + letterWidth + letterGap,
      -letterGap,
    );
    let cursorX = centerX - measuredTitleWidth / 2;

    titleLetters.length = 0;
    [...currentTitle].forEach((char, index) => {
      const letterWidth = measuredLetters[index];

      if (char !== ' ') {
        titleLetters.push(createLetterMotion(
          char,
          cursorX + letterWidth / 2,
          centerY,
          resolvedFontSize,
        ));
      }

      cursorX += letterWidth + letterGap;
    });

    const nextBarrier = Bodies.rectangle(centerX, centerY, titleBounds.width * 0.92, titleBounds.height, {
      chamfer: { radius: titleBounds.height * 0.48 },
      friction: 0.02,
      isStatic: true,
      render: { visible: false },
      restitution: 0.92,
    });

    if (titleBarrier) {
      Composite.remove(engine.world, titleBarrier);
    }
    titleBarrier = nextBarrier;
    Composite.add(engine.world, titleBarrier);
  };

  const buildWorld = () => {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    const arenaRadius = Math.max(Math.min(width, height) * 0.46 * scale, Math.min(width, height) * 0.38 * scale);
    const centerX = width / 2;
    const centerY = height / 2;
    const segmentCount = 36;
    const wallSize = 30;

    render.canvas.width = width * window.devicePixelRatio;
    render.canvas.height = height * window.devicePixelRatio;
    render.canvas.style.width = `${width}px`;
    render.canvas.style.height = `${height}px`;
    render.options.width = width;
    render.options.height = height;
    Render.setPixelRatio(render, window.devicePixelRatio);

    Composite.clear(engine.world, false);
    titleBarrier = null;
    balls.length = 0;
    particles.length = 0;
    titleLetters.length = 0;
    worldCenter = { x: centerX, y: centerY };
    worldRadius = arenaRadius;

    const walls = Array.from({ length: segmentCount }, (_, index) => {
      const angle = (Math.PI * 2 * index) / segmentCount;
      const segmentWidth = (Math.PI * 2 * arenaRadius) / segmentCount + 8;
      const x = centerX + Math.cos(angle) * (arenaRadius + wallSize / 2);
      const y = centerY + Math.sin(angle) * (arenaRadius + wallSize / 2);

      return Bodies.rectangle(x, y, segmentWidth, wallSize, {
        angle: angle + Math.PI / 2,
        friction: 0,
        frictionStatic: 0,
        isStatic: true,
        render: { visible: false },
        restitution: 1.04,
      });
    });

    Composite.add(engine.world, walls);
    layoutTitle();

    const ballCounts = getBallCountConfig(width, initialBallCount, maxBallCount);
    for (let i = 0; i < ballCounts.initial; i += 1) {
      spawnBall(performance.now());
    }
  };

  const spawnBall = (time: number) => {
    const { max } = getBallCountConfig(host.clientWidth, initialBallCount, maxBallCount);
    if (balls.length >= max || worldRadius === 0) return;

    const tone = BALL_PALETTE[Math.floor(Math.random() * BALL_PALETTE.length)];
    const radius = 9 + Math.random() * 4;
    const x = worldCenter.x + (Math.random() - 0.5) * worldRadius * 0.56;
    const y = worldCenter.y - worldRadius - radius - Math.random() * 28;
    const ball = Bodies.circle(x, y, radius, {
      density: 0.0038,
      friction: 0,
      frictionAir: 0.006,
      frictionStatic: 0,
      restitution: 1.02,
      render: { visible: false },
    }) as SceneBody;

    ball.plugin = {
      birthTime: time,
      color: tone.color,
      kind: 'ball',
      lifetime: 7600 + Math.random() * 4200,
      radius,
      ringColor: tone.ringColor,
    };

    Body.setVelocity(ball, { x: (Math.random() - 0.5) * 2.1, y: 3.3 + Math.random() * 2.4 });
    Body.setAngularVelocity(ball, (Math.random() - 0.5) * 0.16);
    balls.push(ball);
    Composite.add(engine.world, ball);
  };

  const popBall = (ball: SceneBody) => {
    const { color, radius = 10, ringColor = '#7edfff' } = ball.plugin;
    const particleCount = 9 + Math.floor(Math.random() * 4);

    for (let i = 0; i < particleCount; i += 1) {
      const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.35;
      const speed = 2.2 + Math.random() * 2.4;

      particles.push({
        age: 0,
        color: i % 3 === 0 ? ringColor : color,
        duration: 360 + Math.random() * 220,
        radius: Math.max(2, radius * (0.18 + Math.random() * 0.16)),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        x: ball.position.x + Math.cos(angle) * radius * 0.45,
        y: ball.position.y + Math.sin(angle) * radius * 0.45,
      });
    }
  };

  const pushFromPointer = () => {
    if (!pointerRef.current.active) return;

    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    const pointerX = pointerRef.current.x * width;
    const pointerY = pointerRef.current.y * height;

    balls.forEach((body) => {
      const deltaX = body.position.x - pointerX;
      const deltaY = body.position.y - pointerY;
      const distance = Math.max(Math.hypot(deltaX, deltaY), 1);
      const effectRadius = 150;

      if (distance > effectRadius) return;

      const falloff = 1 - distance / effectRadius;
      const strength = falloff * 0.00042 * body.mass;

      Body.applyForce(body, body.position, {
        x: (deltaX / distance) * strength,
        y: (deltaY / distance) * strength,
      });
    });
  };

  const updateTitleMotion = () => {
    const pointerX = pointerRef.current.x * Math.max(host.clientWidth, 1);
    const pointerY = pointerRef.current.y * Math.max(host.clientHeight, 1);

    titleLetters.forEach((letter) => {
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

  const updateScene = (event: { timestamp: number }) => {
    const time = event.timestamp;
    const particleDelta = Math.min(time - lastParticleTick, 32);
    lastParticleTick = time;

    pushFromPointer();
    updateTitleMotion();

    if (time - lastSpawnAt > 760 + Math.random() * 220) {
      spawnBall(time);
      lastSpawnAt = time;
    }

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const particle = particles[i];
      particle.age += particleDelta;
      particle.vy += 0.012 * particleDelta;
      particle.x += particle.vx * (particleDelta / 16);
      particle.y += particle.vy * (particleDelta / 16);
      if (particle.age > particle.duration) particles.splice(i, 1);
    }

    for (let i = balls.length - 1; i >= 0; i -= 1) {
      const ball = balls[i];
      const age = time - (ball.plugin.birthTime ?? time);
      const distance = Math.hypot(ball.position.x - worldCenter.x, ball.position.y - worldCenter.y);

      if (age > (ball.plugin.lifetime ?? 9000) || distance > worldRadius + 70) {
        popBall(ball);
        Composite.remove(engine.world, ball);
        balls.splice(i, 1);
      }
    }
  };

  const drawScene = () => {
    const context = render.context;
    const width = Number(render.options.width ?? host.clientWidth);
    const height = Number(render.options.height ?? host.clientHeight);
    const arenaRadius = Math.max(Math.min(width, height) * 0.46 * scale, Math.min(width, height) * 0.38 * scale);
    const centerX = width / 2;
    const centerY = height / 2;

    context.save();
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = '#fb7f6e';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    context.lineWidth = Math.max(width, height) * 0.012;
    context.beginPath();
    context.arc(width * 0.08, height * 0.82, Math.min(width, height) * 0.34, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(width * 0.94, height * 0.04, Math.min(width, height) * 0.2, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = '#3b272b';
    context.beginPath();
    context.arc(centerX, centerY, arenaRadius, 0, Math.PI * 2);
    context.fill();
    context.clip();

    balls.forEach((body) => {
      const { color, radius = 10, ringColor = '#7edfff' } = body.plugin;
      const sprite = getBallSprite(color, radius);

      context.save();
      context.translate(body.position.x, body.position.y);
      context.drawImage(sprite.canvas, -sprite.size / 2, -sprite.size / 2, sprite.size, sprite.size);
      context.rotate(body.angle);
      context.strokeStyle = ringColor;
      context.lineWidth = 2.5;
      context.beginPath();
      context.arc(0, 0, radius * 0.72, -0.35 * Math.PI, 1.1 * Math.PI);
      context.stroke();

      context.strokeStyle = 'rgba(255, 255, 255, 0.72)';
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(0, 0, radius * 0.95, 0.08 * Math.PI, 0.42 * Math.PI);
      context.stroke();
      context.restore();
    });

    particles.forEach((p) => {
      const progress = Math.min(p.age / p.duration, 1);
      context.save();
      context.globalAlpha = 1 - progress;
      context.fillStyle = p.color;
      context.beginPath();
      context.arc(p.x, p.y, p.radius * (1 - progress * 0.45), 0, Math.PI * 2);
      context.fill();
      context.restore();
    });

    titleLetters.forEach((letter) => {
      const sprite = getLetterSprite(letter.char, letter.fontSize);

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

    context.restore();
  };

  buildWorld();
  Events.on(engine, 'beforeUpdate', updateScene);

  let isVisible = true;
  let isPageVisible = !document.hidden;
  let isLoopRunning = false;
  let frameRequestId = 0;
  let lastFrameTime = 0;

  const frame = (time: number) => {
    frameRequestId = window.requestAnimationFrame(frame);

    if (time - lastFrameTime < FRAME_INTERVAL_MS - 1) {
      return;
    }

    lastFrameTime = time;

    for (let step = 0; step < PHYSICS_STEPS_PER_FRAME; step += 1) {
      Engine.update(engine, PHYSICS_STEP_MS);
    }

    // Matter's Render.world is never run: every body is render:{visible:false}
    // and drawScene repaints the full canvas, so its per-frame clear + body
    // iteration produced no visible output. The physics step above (which also
    // drives updateScene) plus this custom draw is the whole frame.
    drawScene();
  };

  const startLoop = () => {
    if (isLoopRunning) return;
    isLoopRunning = true;
    frameRequestId = window.requestAnimationFrame(frame);
  };

  const stopLoop = () => {
    if (!isLoopRunning) return;
    isLoopRunning = false;
    window.cancelAnimationFrame(frameRequestId);
  };

  const syncSceneRunning = () => {
    if (isVisible && isPageVisible) {
      startLoop();
    } else {
      stopLoop();
    }
  };

  const handleVisibilityChange = () => {
    isPageVisible = !document.hidden;
    syncSceneRunning();
  };

  const resizeObserver = new ResizeObserver(buildWorld);
  resizeObserver.observe(host);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    isVisible = entry.isIntersecting;
    syncSceneRunning();
  });
  intersectionObserver.observe(host);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  startLoop();

  const destroy = () => {
    stopLoop();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    intersectionObserver.disconnect();
    resizeObserver.disconnect();
    Events.off(engine, 'beforeUpdate', updateScene);
    Composite.clear(engine.world, false);
    Engine.clear(engine);
    render.canvas.remove();
    render.textures = {};
  };

  return {
    destroy,
    relayoutTitle: layoutTitle,
  };
}
