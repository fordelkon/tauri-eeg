import { Bodies, Body, Composite, Engine, Events, Render } from 'matter-js';
import { getBallSprite } from './matterBallSprite';
import { createPopParticleField } from './matterPopParticles';
import {
  defaultTitleFontSize,
  LETTER_FONT,
} from './matterTitleSprite';
import { createTitleMotionField, type TitleMotion } from './matterTitleMotion';

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
  const particleField = createPopParticleField();
  const titleLetters: TitleMotion[] = [];
  const titleMotionField = createTitleMotionField({ host, letters: titleLetters, pointerRef });
  let titleBounds = {
    height: 38,
    width: 220,
  };
  let worldCenter = { x: 0, y: 0 };
  let worldRadius = 0;
  let lastSpawnAt = 0;
  let lastParticleTick = performance.now();

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
        titleLetters.push(titleMotionField.createLetterMotion(
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
    // Assigning canvas.width/height above RESETS the 2D context transform,
    // and Matter's setPixelRatio early-returns when the ratio is unchanged —
    // so without this, the whole scene renders at 1/dpr in the top-left on
    // any display with devicePixelRatio != 1.
    render.context.setTransform(
      window.devicePixelRatio,
      0,
      0,
      window.devicePixelRatio,
      0,
      0,
    );

    Composite.clear(engine.world, false);
    titleBarrier = null;
    balls.length = 0;
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
    particleField.spawn(ball);
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


  const updateScene = (event: { timestamp: number }) => {
    const time = event.timestamp;
    const particleDelta = Math.min(time - lastParticleTick, 32);
    lastParticleTick = time;

    pushFromPointer();
    titleMotionField.update(balls);

    if (time - lastSpawnAt > 760 + Math.random() * 220) {
      spawnBall(time);
      lastSpawnAt = time;
    }

    particleField.update(particleDelta);

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

    particleField.draw(context);
    titleMotionField.draw(context);

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

  // Drag-resize fires an observation per frame; coalesce to one world
  // rebuild per animation frame (same shape as EegWaveformPanel's
  // resize handling) instead of reallocating canvas + 36 bodies each fire.
  let resizeFrame = 0;
  const resizeObserver = new ResizeObserver(() => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      buildWorld();
    });
  });
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
    if (resizeFrame) {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
    }
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
