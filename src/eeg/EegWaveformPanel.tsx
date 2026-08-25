import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import styles from '../pages/home/EegAcquisition.module.css';
import { MAX_DISPLAY_POINTS_PER_CHANNEL, processEegDisplayFrame } from './eegDisplayFrame';
import { sweepEraseGapSeconds } from './eegSweepDisplay';
import type { EegDisplayMode, EegDisplaySnapshot, EegMarker, EegTriggerCode } from './types';

type Props = {
  amplitudeUvPerDiv: number;
  displayMode?: EegDisplayMode;
  snapshot: EegDisplaySnapshot;
  timeWindowSeconds?: number;
  /**
   * Receives the measured plot width (null on unmount) so the session's
   * takeSnapshot pre-decimates for exactly this panel's frame budget; without
   * it snapshots fall back to full-window copies, which stay correct.
   */
  onPlotWidthChange?: (widthPx: number | null) => void;
};

type UplotData = [Float64Array, ...Float32Array[]];

/** Cursor + marker state the draw hook needs; enough for both display modes. */
type SweepCursorState = {
  cursorX: number;
  markers: EegMarker[];
};

const MARKER_LANE_LABEL = 'TRG';
const MIN_PLOT_WIDTH = 320;
const MIN_PLOT_HEIGHT = 240;
const EMPTY_SERIES = new Float32Array(0);
// Opaque erase-band color; must match the .plotHost :global(.uplot) background
// in EegAcquisition.module.css so the band reads as blank page.
const PLOT_BACKGROUND = '#18211f';
const TRACE_COLORS = [
  '#ff6f61',
  '#2f9e74',
  '#3b7ddd',
  '#d99b1f',
  '#b54a8f',
  '#27a7a8',
];

const TRIGGER_COLORS: Record<EegTriggerCode, string> = {
  1: '#2f9e74',
  2: '#d99b1f',
  3: '#b54a8f',
  4: '#27a7a8',
  255: '#7f8cff',
};

function getLaneHeight(amplitudeUvPerDiv: number) {
  return amplitudeUvPerDiv * 2.5;
}

function getTriggerLaneValue(channelCount: number, amplitudeUvPerDiv: number) {
  return -channelCount * getLaneHeight(amplitudeUvPerDiv);
}

/**
 * Cursor + marker seed for the very first plot draw, mirroring the origin
 * defaults of toSweepDisplayData without its full-window x copy — the frame
 * memo replaces it with the real thing before the first data effect runs.
 */
function initialSweepCursorState(snapshot: EegDisplaySnapshot): SweepCursorState {
  const origin = snapshot.x[0] ?? 0;
  const latestTimeSeconds = snapshot.x[snapshot.x.length - 1] ?? origin;
  return {
    cursorX: Math.max(0, latestTimeSeconds - origin),
    markers: snapshot.markers.map((marker) => ({
      ...marker,
      timeSeconds: Math.max(0, marker.timeSeconds - origin),
    })),
  };
}

function drawTriggerMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  centerY: number,
  classId: EegTriggerCode,
) {
  const pxRatio = uPlot.pxRatio;
  const label = String(classId);
  const badgeWidth = (classId === 255 ? 34 : 24) * pxRatio;
  const badgeHeight = 22 * pxRatio;
  const radius = 6 * pxRatio;
  const left = x - badgeWidth / 2;
  const top = centerY - badgeHeight / 2;
  const right = left + badgeWidth;
  const bottom = top + badgeHeight;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left + radius, top);
  ctx.lineTo(right - radius, top);
  ctx.quadraticCurveTo(right, top, right, top + radius);
  ctx.lineTo(right, bottom - radius);
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
  ctx.lineTo(left + radius, bottom);
  ctx.quadraticCurveTo(left, bottom, left, bottom - radius);
  ctx.lineTo(left, top + radius);
  ctx.quadraticCurveTo(left, top, left + radius, top);
  ctx.closePath();
  ctx.fillStyle = classId === 255 ? '#5865d9' : TRIGGER_COLORS[classId];
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = pxRatio;
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f8fbfc';
  ctx.font = `${12 * pxRatio}px "SFMono-Regular", Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, centerY);
  ctx.restore();
}

export default function EegWaveformPanel({
  amplitudeUvPerDiv,
  displayMode = 'sweep',
  onPlotWidthChange,
  snapshot,
  timeWindowSeconds = 10,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const snapshotRef = useRef(snapshot);
  const sweepOriginRef = useRef<number | null>(snapshot.x[0] ?? null);
  const sweepRef = useRef<SweepCursorState>(initialSweepCursorState(snapshot));
  // Plot width is measured by the ResizeObserver below and flows in through
  // state, so the data memo never reads layout during render.
  const [hostWidth, setHostWidth] = useState(MIN_PLOT_WIDTH);
  const visibleChannelKey = snapshot.visibleChannels.map((channel) => channel.id).join('|');
  const visibleChannels = snapshot.visibleChannels;
  const safeTimeWindowSeconds = Math.max(0.1, timeWindowSeconds);
  // Latest-value refs for the creation effect below: amplitude, display mode
  // and time window change at UI-event rate, and tearing down + rebuilding the
  // dual-canvas uPlot instance on each change is wasted work — its range
  // closures and draw hook read through these instead, so only a change to the
  // visible channel set (series count/order) recreates the plot.
  const amplitudeUvPerDivRef = useRef(amplitudeUvPerDiv);
  amplitudeUvPerDivRef.current = amplitudeUvPerDiv;
  const displayModeRef = useRef(displayMode);
  displayModeRef.current = displayMode;
  const safeTimeWindowSecondsRef = useRef(safeTimeWindowSeconds);
  safeTimeWindowSecondsRef.current = safeTimeWindowSeconds;

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      const width = Math.max(MIN_PLOT_WIDTH, host.clientWidth);
      setHostWidth(width);
      plotRef.current?.setSize({
        width,
        height: Math.max(MIN_PLOT_HEIGHT, host.clientHeight),
      });
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
    };
  }, []);

  // Keep the session's snapshot layer pointed at the exact point budget the
  // frame memo below derives from hostWidth; null on unmount so a stale width
  // cannot outlive this panel.
  useEffect(() => {
    if (!onPlotWidthChange) {
      return undefined;
    }
    onPlotWidthChange(hostWidth);
    return () => onPlotWidthChange(null);
  }, [hostWidth, onPlotWidthChange]);

  const frame = useMemo(() => {
    // The sweep origin latches to the first sample of the stream and resets
    // when the buffer empties; the latch itself is persisted by the effect
    // below, keeping this memo free of side effects.
    const origin = snapshot.x.length === 0
      ? null
      : sweepOriginRef.current ?? snapshot.x[0];
    // Fused frame build: raw-value min/max decimation into reused scratch,
    // then one gather applying correction + clip + phase fold + lane offset.
    // Numerically identical to the staged legacy pipeline (see
    // processEegDisplayFrame) at O(decimated points × channels) per frame.
    const frameData = processEegDisplayFrame(snapshot, {
      originSeconds: origin ?? 0,
      timeWindowSeconds: safeTimeWindowSeconds,
      clipUv: amplitudeUvPerDiv * 5,
      targetPointCount: Math.min(MAX_DISPLAY_POINTS_PER_CHANNEL, hostWidth * 2),
      laneHeightUv: getLaneHeight(amplitudeUvPerDiv),
      displayMode,
    });
    return {
      origin,
      sweep: {
        cursorX: frameData.cursorX,
        markers: frameData.markers,
      },
      data: [
        frameData.x,
        ...visibleChannels.map((channel) => frameData.seriesByChannel[channel.id] ?? EMPTY_SERIES),
      ] as UplotData,
    };
  }, [amplitudeUvPerDiv, displayMode, safeTimeWindowSeconds, snapshot, hostWidth]);

  useEffect(() => {
    sweepOriginRef.current = frame.origin;
  }, [frame]);

  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return undefined;
    }

    const plot = new uPlot({
      width: Math.max(MIN_PLOT_WIDTH, host.clientWidth),
      height: Math.max(MIN_PLOT_HEIGHT, host.clientHeight),
      cursor: { show: false },
      legend: { show: false },
      scales: {
        x: {
          time: false,
          auto: false,
          range: () => {
            const windowSeconds = safeTimeWindowSecondsRef.current;
            if (displayModeRef.current === 'sweep') {
              // Fixed page: the trace writes 0 → window and wraps in place.
              return [0, windowSeconds];
            }
            const cursorX = sweepRef.current.cursorX;
            return [
              Math.max(0, cursorX - windowSeconds),
              Math.max(windowSeconds, cursorX),
            ];
          },
        },
        y: {
          auto: false,
          range: () => {
            const laneHeightUv = getLaneHeight(amplitudeUvPerDivRef.current);
            return [
              -(visibleChannels.length + 0.5) * laneHeightUv,
              laneHeightUv / 2,
            ];
          },
        },
      },
      axes: [
        { show: false },
        { show: false },
      ],
      series: [
        {},
        ...visibleChannels.map((channel, index) => ({
          label: channel.label,
          stroke: TRACE_COLORS[index % TRACE_COLORS.length],
          width: 1,
          points: { show: false },
        })),
      ],
      hooks: {
        draw: [
          (plot) => {
            const { ctx, bbox } = plot;
            const sweep = sweepRef.current;
            const markers = sweep.markers;
            // Read the live config through the latest-value refs so this hook
            // survives amplitude / mode / window changes without a rebuild.
            const amplitudeUvPerDiv = amplitudeUvPerDivRef.current;
            const displayMode = displayModeRef.current;
            const safeTimeWindowSeconds = safeTimeWindowSecondsRef.current;
            const triggerCenterY = plot.valToPos(
              getTriggerLaneValue(snapshotRef.current.visibleChannels.length, amplitudeUvPerDiv),
              'y',
              true,
            );
            const cursorX = plot.valToPos(sweep.cursorX, 'x', true);
            const cursorBandWidth = 10 * uPlot.pxRatio;

            ctx.save();
            if (displayMode === 'sweep') {
              // Opaque erase band just ahead of the write head — the oldest
              // samples (and the cycle-boundary bridge) hide under it, like a
              // monitor erase bar. It wraps to the left edge near the page end.
              const bandEnd = sweep.cursorX + sweepEraseGapSeconds(safeTimeWindowSeconds);
              ctx.fillStyle = PLOT_BACKGROUND;
              if (bandEnd <= safeTimeWindowSeconds) {
                const bandRight = plot.valToPos(bandEnd, 'x', true);
                ctx.fillRect(cursorX, bbox.top, bandRight - cursorX, bbox.height);
              } else {
                ctx.fillRect(cursorX, bbox.top, bbox.left + bbox.width - cursorX, bbox.height);
                const wrappedRight = plot.valToPos(bandEnd - safeTimeWindowSeconds, 'x', true);
                ctx.fillRect(bbox.left, bbox.top, wrappedRight - bbox.left, bbox.height);
              }
            }
            ctx.fillStyle = 'rgba(24, 33, 31, 0.82)';
            ctx.fillRect(cursorX, bbox.top, cursorBandWidth, bbox.height);
            ctx.strokeStyle = 'rgba(239, 235, 228, 0.42)';
            ctx.lineWidth = uPlot.pxRatio;
            ctx.beginPath();
            ctx.moveTo(cursorX, bbox.top);
            ctx.lineTo(cursorX, bbox.top + bbox.height);
            ctx.stroke();
            ctx.restore();

            markers.forEach((marker) => {
              const x = plot.valToPos(marker.timeSeconds, 'x', true);
              const color = TRIGGER_COLORS[marker.classId];

              ctx.save();
              ctx.beginPath();
              ctx.strokeStyle = color;
              ctx.globalAlpha = 0.72;
              ctx.lineWidth = uPlot.pxRatio;
              ctx.moveTo(x, bbox.top + 10);
              ctx.lineTo(x, triggerCenterY - 15 * uPlot.pxRatio);
              ctx.stroke();
              ctx.restore();

              drawTriggerMarker(ctx, x, triggerCenterY, marker.classId);
            });
          },
        ],
      },
    }, frame.data, host);

    plotRef.current = plot;

    return () => {
      plot.destroy();
      plotRef.current = null;
    };
  }, [visibleChannelKey]);

  useEffect(() => {
    sweepRef.current = frame.sweep;
    plotRef.current?.setData(frame.data);
  }, [frame]);

  return (
    <section className={styles.waveformPanel} aria-label="实时脑电波形">
      <div className={styles.channelRail} aria-hidden="true">
        {snapshot.visibleChannels.map((channel) => (
          <span key={channel.id}>{channel.label}</span>
        ))}
        <span>{MARKER_LANE_LABEL}</span>
      </div>
      <div ref={hostRef} className={styles.plotHost} />
    </section>
  );
}
