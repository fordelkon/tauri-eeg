import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { Button } from '@mui/material';
import { type CSSProperties, type PointerEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './NotFound.module.css';

type Point = { x: number; y: number };
type EyeHandles = {
  top: Point;
  right: Point;
  bottom: Point;
  left: Point;
};
type HandleTarget =
  | 'leftOuter'
  | 'rightOuter'
  | 'leftInner'
  | 'rightInner'
  | 'leftEyeTop'
  | 'leftEyeRight'
  | 'leftEyeBottom'
  | 'leftEyeLeft'
  | 'rightEyeTop'
  | 'rightEyeRight'
  | 'rightEyeBottom'
  | 'rightEyeLeft'
  | 'arch'
  | null;

type PointerState = {
  active: boolean;
  target: HandleTarget;
  x: number;
  y: number;
  svgX: number;
  svgY: number;
};

type ShapeHandles = {
  leftOuter: Point;
  rightOuter: Point;
  leftInner: Point;
  rightInner: Point;
  leftEye: EyeHandles;
  rightEye: EyeHandles;
  arch: Point;
};

const defaultPointer: PointerState = {
  active: false,
  target: null,
  x: 0,
  y: 0,
  svgX: 260,
  svgY: 128,
};

const defaultHandles: ShapeHandles = {
  leftOuter: { x: 116, y: 112 },
  rightOuter: { x: 404, y: 112 },
  leftInner: { x: 160, y: 138 },
  rightInner: { x: 360, y: 138 },
  leftEye: {
    top: { x: 224, y: 132 },
    right: { x: 252, y: 160 },
    bottom: { x: 224, y: 188 },
    left: { x: 196, y: 160 },
  },
  rightEye: {
    top: { x: 296, y: 132 },
    right: { x: 324, y: 160 },
    bottom: { x: 296, y: 188 },
    left: { x: 268, y: 160 },
  },
  arch: { x: 260, y: 128 },
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const createEyePath = ({ top, right, bottom, left }: EyeHandles) => {
  const points = [top, right, bottom, left];
  const tension = 0.28;
  const segments = points.map((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    const next = points[(index + 1) % points.length];
    const nextNext = points[(index + 2) % points.length];
    const controlStart = {
      x: point.x + (next.x - previous.x) * tension,
      y: point.y + (next.y - previous.y) * tension,
    };
    const controlEnd = {
      x: next.x - (nextNext.x - point.x) * tension,
      y: next.y - (nextNext.y - point.y) * tension,
    };

    return `C${controlStart.x} ${controlStart.y} ${controlEnd.x} ${controlEnd.y} ${next.x} ${next.y}`;
  });

  return [`M${top.x} ${top.y}`, ...segments, 'Z'].join(' ');
};

export default function NotFound() {
  const navigate = useNavigate();
  const [pointer, setPointer] = useState<PointerState>(defaultPointer);
  const [handles, setHandles] = useState<ShapeHandles>(defaultHandles);

  const getPointerState = (
    event: PointerEvent<HTMLDivElement>,
    active = pointer.active,
    target = pointer.target,
  ): PointerState => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;
    const svgX = clamp((localX / bounds.width) * 520, 86, 434);
    const svgY = clamp((localY / bounds.height) * 280, 42, 214);

    return {
      active,
      target,
      x: localX - bounds.width / 2,
      y: localY - bounds.height / 2,
      svgX,
      svgY,
    };
  };

  const updatePointer = (event: PointerEvent<HTMLDivElement>, active = pointer.active) => {
    const nextPointer = getPointerState(event, active);
    setPointer(nextPointer);

    if (nextPointer.active && nextPointer.target) {
      updateHandle(nextPointer);
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const nextPointer = getPointerState(event, true);
    const cursor = { x: nextPointer.svgX, y: nextPointer.svgY };
    const draggableHandles: Array<{ target: Exclude<HandleTarget, null>; point: Point }> = [
      { target: 'leftOuter', point: handles.leftOuter },
      { target: 'leftInner', point: handles.leftInner },
      { target: 'rightInner', point: handles.rightInner },
      { target: 'rightOuter', point: handles.rightOuter },
      { target: 'leftEyeTop', point: handles.leftEye.top },
      { target: 'leftEyeRight', point: handles.leftEye.right },
      { target: 'leftEyeBottom', point: handles.leftEye.bottom },
      { target: 'leftEyeLeft', point: handles.leftEye.left },
      { target: 'rightEyeTop', point: handles.rightEye.top },
      { target: 'rightEyeRight', point: handles.rightEye.right },
      { target: 'rightEyeBottom', point: handles.rightEye.bottom },
      { target: 'rightEyeLeft', point: handles.rightEye.left },
      { target: 'arch', point: handles.arch },
    ];
    const nearest = draggableHandles.reduce((closest, handle) => (
      distance(cursor, handle.point) < distance(cursor, closest.point) ? handle : closest
    ));
    const target = distance(cursor, nearest.point) < 38
      ? nearest.target
      : nextPointer.svgX < 140
        ? 'leftOuter'
        : nextPointer.svgX < 220
          ? 'leftInner'
          : nextPointer.svgX > 380
            ? 'rightOuter'
            : nextPointer.svgX > 300
              ? 'rightInner'
              : 'arch';

    setPointer({ ...nextPointer, target });
    updateHandle({ ...nextPointer, target });
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    setPointer({ ...pointer, active: false, target: null });
  };

  const updateHandle = (nextPointer: PointerState) => {
    setHandles((currentHandles) => {
      if (nextPointer.target === 'leftOuter') {
        return {
          ...currentHandles,
          leftOuter: {
            x: clamp(nextPointer.svgX, 76, 156),
            y: clamp(nextPointer.svgY, 58, 174),
          },
        };
      }

      if (nextPointer.target === 'rightOuter') {
        return {
          ...currentHandles,
          rightOuter: {
            x: clamp(nextPointer.svgX, 364, 444),
            y: clamp(nextPointer.svgY, 58, 174),
          },
        };
      }

      if (nextPointer.target === 'leftInner') {
        return {
          ...currentHandles,
          leftInner: {
            x: clamp(nextPointer.svgX, 146, 230),
            y: clamp(nextPointer.svgY, 96, 180),
          },
        };
      }

      if (nextPointer.target === 'rightInner') {
        return {
          ...currentHandles,
          rightInner: {
            x: clamp(nextPointer.svgX, 290, 374),
            y: clamp(nextPointer.svgY, 96, 180),
          },
        };
      }

      if (nextPointer.target === 'arch') {
        return {
          ...currentHandles,
          arch: {
            x: clamp(nextPointer.svgX, 220, 300),
            y: clamp(nextPointer.svgY, 84, 176),
          },
        };
      }

      const eyeHandleConfig = {
        leftEyeTop: ['leftEye', 'top', 184, 264, 104, 172],
        leftEyeRight: ['leftEye', 'right', 216, 284, 124, 196],
        leftEyeBottom: ['leftEye', 'bottom', 184, 264, 148, 220],
        leftEyeLeft: ['leftEye', 'left', 164, 232, 124, 196],
        rightEyeTop: ['rightEye', 'top', 256, 336, 104, 172],
        rightEyeRight: ['rightEye', 'right', 288, 356, 124, 196],
        rightEyeBottom: ['rightEye', 'bottom', 256, 336, 148, 220],
        rightEyeLeft: ['rightEye', 'left', 236, 304, 124, 196],
      } as const;
      const eyeConfig = eyeHandleConfig[nextPointer.target as keyof typeof eyeHandleConfig];

      if (eyeConfig) {
        const [eyeName, handleName, minX, maxX, minY, maxY] = eyeConfig;

        return {
          ...currentHandles,
          [eyeName]: {
            ...currentHandles[eyeName],
            [handleName]: {
              x: clamp(nextPointer.svgX, minX, maxX),
              y: clamp(nextPointer.svgY, minY, maxY),
            },
          },
        };
      }

      return currentHandles;
    });
  };

  const pullX = handles.arch.x - 260;
  const pullY = handles.arch.y - 128;
  const archPullX = clamp(pullX * 0.14, -20, 20);
  const archPullY = clamp(pullY * 0.36, -38, 44);
  const leftOuterTopX = handles.leftOuter.x;
  const leftOuterTopY = handles.leftOuter.y;
  const rightOuterTopX = handles.rightOuter.x;
  const rightOuterTopY = handles.rightOuter.y;
  const leftInnerTopX = handles.leftInner.x;
  const leftInnerTopY = handles.leftInner.y;
  const rightInnerTopX = handles.rightInner.x;
  const rightInnerTopY = handles.rightInner.y;
  const topArch = `M116 198 C${leftOuterTopX} ${leftOuterTopY} ${210 + archPullX} 52 260 52 C310 ${52 + archPullY * 0.08} ${rightOuterTopX} ${rightOuterTopY} 404 198`;
  const innerArch = `M160 198 C${leftInnerTopX} ${leftInnerTopY} ${220 + archPullX * 0.46} 92 260 92 C300 ${92 + archPullY * 0.08} ${rightInnerTopX} ${rightInnerTopY} 360 198`;
  const topControl = 'M192 52 L328 52';
  const innerControl = 'M202 92 L318 92';
  const leftInnerHandle = `M${leftInnerTopX} ${leftInnerTopY} L160 198`;
  const rightInnerHandle = `M${rightInnerTopX} ${rightInnerTopY} L360 198`;
  const leftStretch = `M${leftOuterTopX} ${leftOuterTopY} L116 198`;
  const rightStretch = `M${rightOuterTopX} ${rightOuterTopY} L404 198`;
  const leftEye = createEyePath(handles.leftEye);
  const rightEye = createEyePath(handles.rightEye);
  const anchors = [
    { x: leftOuterTopX, y: leftOuterTopY },
    { x: 116, y: 198 },
    { x: 160, y: 198 },
    { x: 192, y: 52 },
    { x: 260, y: 52 },
    { x: 328, y: 52 },
    { x: 360, y: 198 },
    { x: 404, y: 198 },
    { x: rightOuterTopX, y: rightOuterTopY },
    { x: leftInnerTopX, y: leftInnerTopY },
    { x: 202, y: 92 },
    { x: 260, y: 92 },
    { x: 318, y: 92 },
    { x: rightInnerTopX, y: rightInnerTopY },
    handles.leftEye.top,
    handles.leftEye.right,
    handles.leftEye.bottom,
    handles.leftEye.left,
    handles.rightEye.top,
    handles.rightEye.right,
    handles.rightEye.bottom,
    handles.rightEye.left,
  ];

  return (
    <main className={`${styles.page} box-border flex min-h-screen items-center justify-center overflow-hidden`}>
      <section className={`${styles.panel} relative box-border flex w-[min(100%,980px)] flex-col items-center opacity-0`} aria-labelledby="not-found-title">
        <div
          className={`${styles.scene} relative z-1 ${pointer.active ? styles.isPulling : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={updatePointer}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={() => {
            if (!pointer.active) {
              setPointer(defaultPointer);
            }
          }}
          style={{
            '--pointer-x': `${pointer.x}px`,
            '--pointer-y': `${pointer.y}px`,
          } as CSSProperties}
          aria-hidden="true"
        >
          <svg className="block h-full w-full overflow-visible" viewBox="0 0 520 280" role="img">
            <g className={styles.magnetHandle}>
              <path className={styles.guide} d={leftInnerHandle} />
              <path className={styles.guide} d={rightInnerHandle} />
              <path className={styles.stretchLine} d={leftStretch} />
              <path className={styles.guide} d="M116 198 L160 198" />
              <path className={styles.stretchLine} d={rightStretch} />
              <path className={styles.guide} d="M404 198 L360 198" />
            </g>
            <g className={styles.face}>
              <path className={styles.handleLine} d={topControl} />
              <path className={styles.handleLine} d={innerControl} />
              <path className={styles.guide} d={topArch} />
              <path className={styles.guide} d={innerArch} />
              <path className={styles.eye} d={leftEye} />
              <path className={styles.eye} d={rightEye} />
            </g>
            <circle className={styles.pullPoint} cx={pointer.svgX} cy={pointer.svgY} r={pointer.active ? 7 : 0} />
            {anchors.map((anchor, index) => (
              <circle
                key={`anchor-${index}`}
                className={styles.anchor}
                cx={anchor.x}
                cy={anchor.y}
                r="4"
              />
            ))}
          </svg>
        </div>

        <div className={`${styles.content} relative z-1 flex flex-col items-center text-center opacity-0`}>
          <p className={styles.eyebrow}>404</p>
          <h1 id="not-found-title" className={styles.title}>页面未找到</h1>
          <p className={styles.description}>
            当前 EEG 系统路由尚未实现。
          </p>
          <Button
            className={`${styles.backButton} h-48px px-24px text-white`}
            startIcon={<ArrowBackRoundedIcon />}
            onClick={() => navigate('/login')}
            variant="contained"
          >
            返回登录
          </Button>
        </div>
      </section>
    </main>
  );
}
