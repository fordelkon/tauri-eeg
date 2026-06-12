import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import styles from '../pages/home/EegAcquisition.module.css';
import { toSweepDisplayData } from './eegSweepDisplay';
import type { EegDisplaySnapshot, EegTriggerCode } from './types';

type Props = {
  amplitudeUvPerDiv: number;
  snapshot: EegDisplaySnapshot;
  timeWindowSeconds?: number;
};

type UplotData = [number[], ...Array<Array<number | null>>];

const MARKER_LANE_LABEL = 'TRG';
const MIN_PLOT_WIDTH = 320;
const MIN_PLOT_HEIGHT = 240;
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
  255: '#7f8cff',
};

function getLaneHeight(amplitudeUvPerDiv: number) {
  return amplitudeUvPerDiv * 2.5;
}

function getTriggerLaneValue(channelCount: number, amplitudeUvPerDiv: number) {
  return -channelCount * getLaneHeight(amplitudeUvPerDiv);
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
  snapshot,
  timeWindowSeconds = 10,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const snapshotRef = useRef(snapshot);
  const sweepOriginRef = useRef<number | null>(snapshot.x[0] ?? null);
  const sweepRef = useRef(toSweepDisplayData(
    snapshot,
    timeWindowSeconds,
    sweepOriginRef.current ?? undefined,
  ));
  const visibleChannelKey = snapshot.visibleChannels.map((channel) => channel.id).join('|');
  const visibleChannels = snapshot.visibleChannels;
  const safeTimeWindowSeconds = Math.max(0.1, timeWindowSeconds);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const data = useMemo<UplotData>(() => {
    if (snapshot.x.length === 0) {
      sweepOriginRef.current = null;
    } else if (sweepOriginRef.current === null) {
      sweepOriginRef.current = snapshot.x[0];
    }

    const sweepOrigin = sweepOriginRef.current ?? 0;
    const sweep = toSweepDisplayData(snapshot, safeTimeWindowSeconds, sweepOrigin);
    const laneHeight = getLaneHeight(amplitudeUvPerDiv);
    const series = snapshot.visibleChannels.map((channel, channelIndex) => {
      const laneOffset = -channelIndex * laneHeight;
      return (sweep.seriesByChannel[channel.id] ?? []).map((value) => (
        value === null ? null : value + laneOffset
      ));
    });

    sweepRef.current = sweep;

    return [sweep.x, ...series];
  }, [amplitudeUvPerDiv, safeTimeWindowSeconds, snapshot]);

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
            const cursorX = sweepRef.current.cursorX;
            return [
              Math.max(0, cursorX - safeTimeWindowSeconds),
              Math.max(safeTimeWindowSeconds, cursorX),
            ];
          },
        },
        y: {
          auto: false,
          range: () => [
            -(visibleChannels.length + 0.5) * getLaneHeight(amplitudeUvPerDiv),
            getLaneHeight(amplitudeUvPerDiv) / 2,
          ],
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
            const triggerCenterY = plot.valToPos(
              getTriggerLaneValue(snapshotRef.current.visibleChannels.length, amplitudeUvPerDiv),
              'y',
              true,
            );
            const cursorX = plot.valToPos(sweep.cursorX, 'x', true);
            const cursorBandWidth = 10 * uPlot.pxRatio;

            ctx.save();
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
    }, data, host);

    plotRef.current = plot;

    const observer = new ResizeObserver(() => {
      plot.setSize({
        width: Math.max(MIN_PLOT_WIDTH, host.clientWidth),
        height: Math.max(MIN_PLOT_HEIGHT, host.clientHeight),
      });
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [amplitudeUvPerDiv, safeTimeWindowSeconds, visibleChannelKey]);

  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  return (
    <section className={styles.waveformPanel} aria-label="Realtime EEG waveform">
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
