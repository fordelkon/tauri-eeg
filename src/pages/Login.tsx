import LockRoundedIcon from '@mui/icons-material/LockRounded';
import MailRoundedIcon from '@mui/icons-material/MailRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import {
  Box,
  Button,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material';
import {
  Bodies,
  Body,
  Composite,
  Engine,
  Events,
  Render,
  Runner,
} from 'matter-js';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './Login.module.css';

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

export default function Login() {
  const navigate = useNavigate();
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const matterHostRef = useRef<HTMLDivElement>(null);
  const pointerTargetRef = useRef<{ active: boolean; x: number; y: number }>({
    active: false,
    x: 0.5,
    y: 0.5,
  });
  const [account, setAccount] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [hasError, setHasError] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');

  const isSignup = authMode === 'signup';

  useEffect(() => {
    const host = matterHostRef.current;

    if (!host || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
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

    const runner = Runner.create();
    const balls: SceneBody[] = [];
    const particles: PopParticle[] = [];
    const title = 'EEG Ecosystem';
    const titleLetters: TitleMotion[] = [];
    let titleBounds = {
      height: 38,
      width: 220,
    };
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
    let worldCenter = { x: 0, y: 0 };
    let worldRadius = 0;
    let lastSpawnAt = 0;
    let lastParticleTick = performance.now();

    const buildWorld = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      const arenaRadius = Math.max(Math.min(width, height) * 0.46, Math.min(width, height) * 0.38);
      const centerX = width / 2;
      const centerY = height / 2;
      const wallSize = 30;
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

      const titleFontSize = width > 420 ? 31 : Math.max(20, Math.min(25, width * 0.072));

      render.context.font = `560 ${titleFontSize}px "Comic Sans MS", "Trebuchet MS", "Segoe UI", Arial, sans-serif`;
      titleBounds = {
        height: titleFontSize * 1.28,
        width: Math.max(render.context.measureText(title).width, titleFontSize * 7.2),
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
      for (let index = 0; index < initialBallCount; index += 1) {
        spawnBall(performance.now());
      }
    };

    const spawnBall = (
      time: number,
      palette = [
        { color: '#ff3d1f', ringColor: '#7edfff' },
        { color: '#ffc321', ringColor: '#47c8ff' },
        { color: '#a238ff', ringColor: '#7cf0ff' },
        { color: '#c3e9f1', ringColor: '#1b1b1d' },
        { color: '#d36a20', ringColor: '#8ee8ff' },
      ],
    ) => {
      const maxBalls = host.clientWidth > 420 ? 10 : 6;

      if (balls.length >= maxBalls || worldRadius === 0) {
        return;
      }

      const tone = palette[Math.floor(Math.random() * palette.length)];
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

      Body.setVelocity(ball, {
        x: (Math.random() - 0.5) * 2.1,
        y: 3.3 + Math.random() * 2.4,
      });
      Body.setAngularVelocity(ball, (Math.random() - 0.5) * 0.16);
      balls.push(ball);
      Composite.add(engine.world, ball);
    };

    const popBall = (ball: SceneBody) => {
      const { color, radius = 10, ringColor = '#7edfff' } = ball.plugin;
      const particleCount = 9 + Math.floor(Math.random() * 4);

      for (let index = 0; index < particleCount; index += 1) {
        const angle = (Math.PI * 2 * index) / particleCount + Math.random() * 0.35;
        const speed = 2.2 + Math.random() * 2.4;

        particles.push({
          age: 0,
          color: index % 3 === 0 ? ringColor : color,
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
      const pointerTarget = pointerTargetRef.current;

      if (!pointerTarget.active) {
        return;
      }

      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      const pointerX = pointerTarget.x * width;
      const pointerY = pointerTarget.y * height;

      balls.forEach((body) => {
        const deltaX = body.position.x - pointerX;
        const deltaY = body.position.y - pointerY;
        const distance = Math.max(Math.hypot(deltaX, deltaY), 1);
        const effectRadius = 150;

        if (distance > effectRadius) {
          return;
        }

        const falloff = 1 - distance / effectRadius;
        const strength = falloff * 0.00042 * body.mass;

        Body.applyForce(body, body.position, {
          x: (deltaX / distance) * strength,
          y: (deltaY / distance) * strength,
        });
      });
    };

    const updateTitleMotion = () => {
      const pointerX = pointerTargetRef.current.x * Math.max(host.clientWidth, 1);
      const pointerY = pointerTargetRef.current.y * Math.max(host.clientHeight, 1);

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

          if (distance > range) {
            return;
          }

          const falloff = (1 - distance / range) ** 2;

          targetX += (deltaX / distance) * falloff * 18;
          targetY += (deltaY / distance) * falloff * 13;
          targetRotation += (deltaX / range) * falloff * 0.42;
          targetSquash += falloff * 0.2;
        });

        if (pointerTargetRef.current.active) {
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
        titleBounds.width = Math.max(titleBounds.width, letter.fontSize);
        letter.velocityX = (letter.velocityX + (targetX - letter.x) * 0.14) * 0.72;
        letter.velocityY = (letter.velocityY + (targetY - letter.y) * 0.14) * 0.72;
        letter.rotationVelocity = (letter.rotationVelocity + (targetRotation - letter.rotation) * 0.16) * 0.68;
        letter.squashVelocity = (letter.squashVelocity + (targetSquash - letter.squash) * 0.18) * 0.68;
        letter.x += letter.velocityX;
        letter.y += letter.velocityY;
        letter.rotation += letter.rotationVelocity;
        letter.squash += letter.squashVelocity;

        if (!pointerTargetRef.current.active && Math.hypot(letter.x, letter.y) < 0.12) {
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

      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];

        particle.age += particleDelta;
        particle.vy += 0.012 * particleDelta;
        particle.x += particle.vx * (particleDelta / 16);
        particle.y += particle.vy * (particleDelta / 16);

        if (particle.age > particle.duration) {
          particles.splice(index, 1);
        }
      }

      for (let index = balls.length - 1; index >= 0; index -= 1) {
        const ball = balls[index];
        const age = time - (ball.plugin.birthTime ?? time);
        const distance = Math.hypot(ball.position.x - worldCenter.x, ball.position.y - worldCenter.y);

        if (age > (ball.plugin.lifetime ?? 9000) || distance > worldRadius + 70) {
          popBall(ball);
          Composite.remove(engine.world, ball);
          balls.splice(index, 1);
        }
      }
    };

    const drawScene = () => {
      const context = render.context;
      const width = Number(render.options.width ?? host.clientWidth);
      const height = Number(render.options.height ?? host.clientHeight);
      const arenaRadius = Math.max(Math.min(width, height) * 0.46, Math.min(width, height) * 0.38);
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

        context.save();
        context.translate(body.position.x, body.position.y);
        context.rotate(body.angle);
        context.shadowBlur = 8;
        context.shadowColor = 'rgba(63, 32, 36, 0.28)';
        context.fillStyle = color;
        context.beginPath();
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.fill();

        context.shadowBlur = 0;
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

      particles.forEach((particle) => {
        const progress = Math.min(particle.age / particle.duration, 1);

        context.save();
        context.globalAlpha = 1 - progress;
        context.fillStyle = particle.color;
        context.beginPath();
        context.arc(
          particle.x,
          particle.y,
          particle.radius * (1 - progress * 0.45),
          0,
          Math.PI * 2,
        );
        context.fill();
        context.restore();
      });

      context.shadowBlur = 0;
      context.fillStyle = '#ffffff';
      titleLetters.forEach((letter) => {
        context.save();
        context.translate(letter.baseX + letter.x, letter.baseY + letter.y);
        context.rotate(letter.rotation);
        context.scale(1 + letter.squash * 0.18, 1 - letter.squash * 0.12);
        context.shadowBlur = 1.5;
        context.shadowColor = 'rgba(255, 255, 255, 0.28)';
        context.font = `560 ${letter.fontSize}px "Comic Sans MS", "Trebuchet MS", "Segoe UI", Arial, sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(letter.char, 0, 0);
        context.restore();
      });

      context.restore();

      context.save();
      context.fillStyle = '#3b272b';
      context.font = `700 ${width > 420 ? 12 : 10}px Arial, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('', centerX, centerY);
      context.restore();
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
  }, []);

  useEffect(() => {
    if (!hasError) {
      return;
    }

    const timer = window.setTimeout(() => {
      setHasError(false);
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [hasError]);

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isSignup) {
      setHasError(false);
      return;
    }

    if (account.trim() === 'admin' && password === '123456') {
      setHasError(false);
      navigate('/home');
      return;
    }

    setHasError(true);
    setIsShaking(false);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setIsShaking(true);
      });
    });
  };

  const handleModeChange = (mode: 'signin' | 'signup') => {
    setAuthMode(mode);
    setHasError(false);
    setIsShaking(false);
    setShowPassword(false);
  };

  const handleLeftPanelPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();

    pointerTargetRef.current = {
      active: true,
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
  };

  const handleLeftPanelPointerLeave = () => {
    pointerTargetRef.current = {
      ...pointerTargetRef.current,
      active: false,
    };
  };

  return (
    <Box className={`${styles.container} relative box-border flex min-h-screen flex-col items-stretch justify-center gap-0 overflow-hidden`}>
      <Box
        ref={leftPanelRef}
        className={`${styles.leftPanel} relative box-border flex w-full flex-none touch-none items-center justify-center overflow-hidden text-white opacity-0`}
        onPointerMove={handleLeftPanelPointerMove}
        onPointerLeave={handleLeftPanelPointerLeave}
        aria-label="EEG Ecosystem animated scene"
      >
        <div
          className={`${styles.glassScene} pointer-events-none absolute inset-0 z-0 overflow-hidden`}
          aria-hidden="true"
        >
          <div ref={matterHostRef} className="absolute inset-0 opacity-100" />
        </div>
      </Box>

      <Box className={`${styles.rightPanel} box-border flex w-full flex-1 items-center justify-center overflow-hidden opacity-0`}>
        <Box className={`${styles.formPanel} flex w-full max-w-360px flex-col items-center opacity-0`}>
          <span className={styles.brandMark} aria-hidden="true" />
          <Typography variant="h4" component="h1" className={`${styles.title} mb-8px text-center`}>
            EEG Ecosystem
          </Typography>
          <Typography variant="body2" className={`${styles.subtitle} mb-34px text-center`}>
            {isSignup ? 'Create your account.' : 'Sign in to continue.'}
          </Typography>

          <form onSubmit={handleAuthSubmit} className="w-full">
            <Box className={`${styles.fieldGroup} mb-24px flex flex-col gap-16px ${hasError ? styles.isError : ''}`}>
              <TextField
                className={`${styles.textField} ${isShaking ? styles.isShaking : ''}`}
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                label="Account"
                placeholder="Email or User ID"
                autoComplete="username"
                error={hasError}
                fullWidth
                variant="outlined"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <PersonRoundedIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  },
                }}
              />

              {isSignup ? (
                <TextField
                  className={styles.textField}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  label="Email"
                  placeholder="name@example.com"
                  autoComplete="email"
                  fullWidth
                  type="email"
                  variant="outlined"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <MailRoundedIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              ) : null}

              <TextField
                className={`${styles.textField} ${isShaking ? styles.isShaking : ''}`}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                label="Password"
                placeholder="Password"
                autoComplete="current-password"
                error={hasError}
                fullWidth
                type={showPassword ? 'text' : 'password'}
                variant="outlined"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockRoundedIcon fontSize="small" />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          edge="end"
                          size="small"
                          onClick={() => setShowPassword((value) => !value)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? (
                            <VisibilityOffRoundedIcon fontSize="small" />
                          ) : (
                            <VisibilityRoundedIcon fontSize="small" />
                          )}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />

              {isSignup ? (
                <TextField
                  className={styles.textField}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  label="Confirm Password"
                  placeholder="Confirm password"
                  autoComplete="new-password"
                  fullWidth
                  type="password"
                  variant="outlined"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <LockRoundedIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              ) : null}

              {!isSignup ? (
                <p className={`${styles.errorMsg} pl-2px`}>Account or password is incorrect.</p>
              ) : null}
            </Box>

            <Button
              type="submit"
              className={`${styles.submitButton} mb-24px h-50px w-full px-22px`}
              fullWidth
              variant="contained"
            >
              {isSignup ? 'Sign Up' : 'Sign In'}
            </Button>

            <Button
              type="button"
              className={`${styles.modeSwitchButton} mb-18px w-full px-0`}
              fullWidth
              variant="text"
              onClick={() => handleModeChange(isSignup ? 'signin' : 'signup')}
            >
              {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </Button>

            {!isSignup ? (
              <Typography variant="body1" className={`${styles.forgotPassword} cursor-pointer text-center`}>
                Forgotten your password?
              </Typography>
            ) : null}
          </form>
        </Box>
      </Box>
    </Box>
  );
}
