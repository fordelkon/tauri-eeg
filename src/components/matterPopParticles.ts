/**
 * Pop-particle field for the matter background: the confetti burst a ball
 * emits when its lifetime ends. Owns the particle array and its update/draw
 * cadence so the background scene only spawns and paints.
 */

export type PopParticle = {
  age: number;
  color: string;
  duration: number;
  radius: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
};

export type PopParticleField = {
  draw: (context: CanvasRenderingContext2D) => void;
  spawn: (ball: {
    position: { x: number; y: number };
    plugin: { color: string; radius?: number; ringColor?: string };
  }) => void;
  update: (deltaMs: number) => void;
};

export function createPopParticleField(): PopParticleField {
  const particles: PopParticle[] = [];

  const spawn = (ball: {
    position: { x: number; y: number };
    plugin: { color: string; radius?: number; ringColor?: string };
  }) => {
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

  const update = (particleDelta: number) => {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const particle = particles[i];
      particle.age += particleDelta;
      particle.vy += 0.012 * particleDelta;
      particle.x += particle.vx * (particleDelta / 16);
      particle.y += particle.vy * (particleDelta / 16);
      if (particle.age > particle.duration) particles.splice(i, 1);
    }
  };

  const draw = (context: CanvasRenderingContext2D) => {
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
  };

  return { draw, spawn, update };
}
