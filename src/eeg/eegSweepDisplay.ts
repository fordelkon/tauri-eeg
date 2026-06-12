import type { EegDisplaySnapshot, EegMarker } from './types';

export type SweepDisplayData = {
  currentCycle: number;
  cursorX: number;
  markers: EegMarker[];
  seriesByChannel: Record<string, number[]>;
  x: number[];
};

export function toSweepDisplayData(
  snapshot: EegDisplaySnapshot,
  timeWindowSeconds: number,
  sweepOriginSeconds = snapshot.x[0] ?? 0,
): SweepDisplayData {
  const safeWindowSeconds = Math.max(0.1, timeWindowSeconds);
  const latestTimeSeconds = snapshot.x[snapshot.x.length - 1] ?? sweepOriginSeconds;
  const latestRelativeSeconds = Math.max(0, latestTimeSeconds - sweepOriginSeconds);
  const currentCycle = Math.floor(latestRelativeSeconds / safeWindowSeconds);
  const cursorX = latestRelativeSeconds;

  const x = snapshot.x.map((timeSeconds) => Math.max(0, timeSeconds - sweepOriginSeconds));
  const seriesByChannel = Object.fromEntries(
    Object.entries(snapshot.seriesByChannel).map(([channelId, values]) => [channelId, values]),
  );

  return {
    currentCycle,
    cursorX,
    markers: snapshot.markers
      .map((marker) => ({
        ...marker,
        timeSeconds: Math.max(0, marker.timeSeconds - sweepOriginSeconds),
      })),
    seriesByChannel,
    x,
  };
}
