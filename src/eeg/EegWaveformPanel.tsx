import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import styles from '../pages/home/EegAcquisition.module.css';
import type { EegDisplaySnapshot, EegTriggerCode } from './types';

type Props = {
  amplitudeUvPerDiv: number;
  snapshot: EegDisplaySnapshot;
};

type UplotData = [number[], ...number[][]];

const MARKER_LANE_LABEL = 'TRG';
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

export default function EegWaveformPanel({ amplitudeUvPerDiv, snapshot }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const snapshotRef = useRef(snapshot);
  const visibleChannelKey = snapshot.visibleChannels.map((channel) => channel.id).join('|');
  const visibleChannels = snapshot.visibleChannels;

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const data = useMemo<UplotData>(() => {
    const laneHeight = getLaneHeight(amplitudeUvPerDiv);
    const series = snapshot.visibleChannels.map((channel, channelIndex) => {
      const laneOffset = -channelIndex * laneHeight;
      return (snapshot.seriesByChannel[channel.id] ?? []).map((value) => value + laneOffset);
    });

    return [snapshot.x, ...series];
  }, [amplitudeUvPerDiv, snapshot]);

  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return undefined;
    }

    const plot = new uPlot({
      width: Math.max(320, host.clientWidth),
      height: Math.max(360, host.clientHeight),
      cursor: { show: false },
      legend: { show: false },
      scales: {
        x: { time: false },
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
            const markers = snapshotRef.current.markers;
            const triggerCenterY = plot.valToPos(
              getTriggerLaneValue(snapshotRef.current.visibleChannels.length, amplitudeUvPerDiv),
              'y',
              true,
            );

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
        width: Math.max(320, host.clientWidth),
        height: Math.max(360, host.clientHeight),
      });
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [amplitudeUvPerDiv, visibleChannelKey]);

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
