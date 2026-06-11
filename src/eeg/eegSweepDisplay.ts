import type { EegDisplaySnapshot, EegMarker } from './types';

export type SweepDisplayData = {
  currentCycle: number;
  cursorX: number;
  markers: EegMarker[];
  seriesByChannel: Record<string, Array<number | null>>;
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
  const cursorX = latestRelativeSeconds % safeWindowSeconds;

  const x: number[] = [];
  const seriesByChannel = Object.fromEntries(
    Object.entries(snapshot.seriesByChannel).map(([channelId]) => [channelId, [] as Array<number | null>]),
  );

  snapshot.x.forEach((timeSeconds, sampleIndex) => {
    const relativeSeconds = Math.max(0, timeSeconds - sweepOriginSeconds);
    const sweepX = relativeSeconds % safeWindowSeconds;

    if (sampleIndex > 0) {
      const previousRelativeSeconds = Math.max(0, snapshot.x[sampleIndex - 1] - sweepOriginSeconds);
      const previousCycle = Math.floor(previousRelativeSeconds / safeWindowSeconds);
      const sampleCycle = Math.floor(relativeSeconds / safeWindowSeconds);

      if (sampleCycle !== previousCycle) {
        x.push(sweepX);
        Object.keys(seriesByChannel).forEach((channelId) => {
          seriesByChannel[channelId].push(null);
        });
      }
    }

    x.push(sweepX);
    Object.entries(snapshot.seriesByChannel).forEach(([channelId, values]) => {
      seriesByChannel[channelId].push(values[sampleIndex] ?? null);
    });
  });

  return {
    currentCycle,
    cursorX,
    markers: snapshot.markers
      .map((marker) => ({
        ...marker,
        timeSeconds: Math.max(0, marker.timeSeconds - sweepOriginSeconds),
      }))
      .filter((marker) => Math.floor(marker.timeSeconds / safeWindowSeconds) === currentCycle)
      .map((marker) => ({
        ...marker,
        timeSeconds: marker.timeSeconds % safeWindowSeconds,
      })),
    seriesByChannel,
    x,
  };
}
