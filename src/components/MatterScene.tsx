import {
  Bodies,
  Body,
  Composite,
  Engine,
  Events,
  Render,
  Runner,
} from 'matter-js';
import { useEffect, useRef } from 'react';

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

type Props = {
  className?: string;
  scale?: number;
  title?: string;
};

export default function MatterScene({ className = '', scale = 1, title = 'EEG Ecosystem' }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef({ active: false, x: 0.5, y: 0.5 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

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

    const runner = Runner.create();
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
      fontSize,
      rotation: 0,
      rotationVelocity: 0,
      squash: 0,
      squashVelocity: 0,
      velocityX: 0,
      velocityY: 0,
      x: 0,
      y: 0,
    });

    const buildWorld = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      const arenaRadius = Math.max(Math.min(width, height) * 0.46 * scale, Math.min(width, height) * 0.38 * scale);
      const centerX = width / 2;
      const centerY = height / 2;
      const segmentCount = 36;

      render.canvas.width = width * window.devicePixelRatio;
      render.canvas.height = height * window.devicePixelRatio;
      render.canvas.style.width = `${width}px`;
      render.canvas.style.height = `${height}px`;
      render.options.width = width;
      render.options.height = height;
      Render.setPixelRatio(render, window.devicePixelRatio);

      Composite.clear(engine.world, false);
      balls.length = 0;
      particles.length = 0;
      titleLetters.length = 0;
      worldCenter = { x: centerX, y: centerY };
      worldRadius = arenaRadius;

      const walls = Array.from({ length: segmentCount }, (_, index) => {
        const angle = (Math.PI * 2 * index) / segmentCount;
        const segmentWidth = (Math.PI * 2 * arenaRadius) / segmentCount + 8;
        const x = centerX + Math.cos(angle) * (arenaRadius + 15);
        const y = centerY + Math.sin(angle) * (arenaRadius + 15);

        return Bodies.rectangle(x, y, segmentWidth, 30, {
          angle: angle + Math.PI / 2,
          friction: 0,
          isStatic: true,
          render: { visible: false },
          restitution: 1.04,
        });
      });

      const titleFontSize = width > 420 ? Math.min(42, Math.max(28, width * 0.045)) : Math.max(20, Math.min(25, width * 0.072));

      render.context.font = `560 ${titleFontSize}px "Comic Sans MS", "Trebuchet MS", "Segoe UI", Arial, sans-serif`;
      titleBounds = {
        height: titleFontSize * 1.28,
        width: Math.max(render.context.measureText(title).width, titleFontSize * Math.min(title.length, 11) * 0.62),
      };

      const letterGap = titleFontSize * 0.025;
      const measuredLetters = [...title].map((char) => (
        char === ' ' ? titleFontSize * 0.4 : render.context.measureText(char).width
      ));
      const measuredTitleWidth = measuredLetters.reduce(
        (total, letterWidth) => total + letterWidth + letterGap,
        -letterGap,
      );
      let cursorX = centerX - measuredTitleWidth / 2;

      [...title].forEach((char, index) => {
        const letterWidth = measuredLetters[index];

        if (char !== ' ') {
          titleLetters.push(createLetterMotion(
            char,
            cursorX + letterWidth / 2,
            centerY,
            titleFontSize,
          ));
        }

        cursorX += letterWidth + letterGap;
      });

      const titleBarrier = Bodies.rectangle(centerX, centerY, titleBounds.width * 0.92, titleBounds.height, {
        chamfer: { radius: titleBounds.height * 0.48 },
        friction: 0.02,
        isStatic: true,
        render: { visible: false },
        restitution: 0.92,
      });

      Composite.add(engine.world, [...walls, titleBarrier]);

      const initialBallCount = width > 420 ? 5 : 3;
      for (let i = 0; i < initialBallCount; i++) spawnBall(performance.now());
    };

    const spawnBall = (time: number) => {
      const maxBalls = host.clientWidth > 420 ? 10 : 6;
      if (balls.length >= maxBalls || worldRadius === 0) return;

      const palette = [
        { color: '#ff3d1f', ringColor: '#7edfff' },
        { color: '#ffc321', ringColor: '#47c8ff' },
        { color: '#a238ff', ringColor: '#7cf0ff' },
        { color: '#c3e9f1', ringColor: '#1b1b1d' },
        { color: '#d36a20', ringColor: '#8ee8ff' },
      ];
      const tone = palette[Math.floor(Math.random() * palette.length)];
      const radius = 9 + Math.random() * 4;
      const x = worldCenter.x + (Math.random() - 0.5) * worldRadius * 0.56;
      const y = worldCenter.y - worldRadius - radius - Math.random() * 28;
      const ball = Bodies.circle(x, y, radius, {
        density: 0.0038,
        friction: 0,
        frictionAir: 0.006,
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

      for (let i = 0; i < particleCount; i++) {
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

      for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        particle.age += particleDelta;
        particle.vy += 0.012 * particleDelta;
        particle.x += particle.vx * (particleDelta / 16);
        particle.y += particle.vy * (particleDelta / 16);
        if (particle.age > particle.duration) particles.splice(i, 1);
      }

      for (let i = balls.length - 1; i >= 0; i--) {
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
      const ctx = render.context;
      const width = Number(render.options.width ?? host.clientWidth);
      const height = Number(render.options.height ?? host.clientHeight);
      const arenaRadius = Math.max(Math.min(width, height) * 0.46 * scale, Math.min(width, height) * 0.38 * scale);
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.save();
      ctx.fillStyle = '#fb7f6e';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
      ctx.lineWidth = Math.max(width, height) * 0.012;
      ctx.beginPath();
      ctx.arc(width * 0.08, height * 0.82, Math.min(width, height) * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(width * 0.94, height * 0.04, Math.min(width, height) * 0.2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#3b272b';
      ctx.beginPath();
      ctx.arc(centerX, centerY, arenaRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.clip();

      balls.forEach((body) => {
        const { color, radius = 10, ringColor = '#7edfff' } = body.plugin;
        ctx.save();
        ctx.translate(body.position.x, body.position.y);
        ctx.rotate(body.angle);
        ctx.shadowBlur = 8;
        ctx.shadowColor = 'rgba(63, 32, 36, 0.28)';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.72, -0.35 * Math.PI, 1.1 * Math.PI);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.95, 0.08 * Math.PI, 0.42 * Math.PI);
        ctx.stroke();
        ctx.restore();
      });

      particles.forEach((p) => {
        const progress = Math.min(p.age / p.duration, 1);
        ctx.save();
        ctx.globalAlpha = 1 - progress;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * (1 - progress * 0.45), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      titleLetters.forEach((letter) => {
        ctx.save();
        ctx.translate(letter.baseX + letter.x, letter.baseY + letter.y);
        ctx.rotate(letter.rotation);
        ctx.scale(1 + letter.squash * 0.18, 1 - letter.squash * 0.12);
        ctx.shadowBlur = 1.5;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.28)';
        ctx.font = `560 ${letter.fontSize}px "Comic Sans MS", "Trebuchet MS", "Segoe UI", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(letter.char, 0, 0);
        ctx.restore();
      });

      ctx.restore();
    };

    buildWorld();
    Render.run(render);
    Runner.run(runner, engine);
    Events.on(engine, 'beforeUpdate', updateScene);
    Events.on(render, 'afterRender', drawScene);

    const resizeObserver = new ResizeObserver(buildWorld);
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      Events.off(engine, 'beforeUpdate', updateScene);
      Events.off(render, 'afterRender', drawScene);
      Render.stop(render);
      Runner.stop(runner);
      Composite.clear(engine.world, false);
      Engine.clear(engine);
      render.canvas.remove();
      render.textures = {};
    };
  }, [scale, title]);

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
