import type { EegDisplaySnapshot, EegMarker } from './types';

export type SweepDisplayData = {
  currentCycle: number;
  cursorX: number;
  markers: EegMarker[];
  seriesByChannel: Record<string, Float32Array>;
  x: Float64Array;
};

export type SweepPageData = {
  /** Phase (0..window) of the newest sample — the sweep write head. */
  cursorX: number;
  /** Width of the blank band ahead of the cursor, in seconds. */
  eraseGapSeconds: number;
  /** Phase-folded x values, ascending (uPlot binary-searches the x axis). */
  x: Float64Array;
  /** Series rotated to match x: current cycle first, previous cycle after. */
  seriesByChannel: Record<string, Float32Array>;
  /** Phase-mapped markers; those inside the erase band are already dropped. */
  markers: EegMarker[];
};

const MAX_ERASE_GAP_SECONDS = 0.4;
const ERASE_GAP_WINDOW_RATIO = 0.05;

/**
 * Blank band ahead of the sweep cursor, following monitor convention: wide
 * enough to hide the old trace and marker tails, never more than 0.4 s.
 */
export function sweepEraseGapSeconds(timeWindowSeconds: number) {
  return Math.min(MAX_ERASE_GAP_SECONDS, Math.max(0.05, timeWindowSeconds * ERASE_GAP_WINDOW_RATIO));
}

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

  const x = new Float64Array(snapshot.x.length);
  for (let index = 0; index < snapshot.x.length; index += 1) {
    x[index] = Math.max(0, snapshot.x[index] - sweepOriginSeconds);
  }

  return {
    currentCycle,
    cursorX,
    markers: snapshot.markers
      .map((marker) => ({
        ...marker,
        timeSeconds: Math.max(0, marker.timeSeconds - sweepOriginSeconds),
      })),
    // Series arrays are already fresh per-frame typed buffers; sharing the
    // record (instead of rebuilding it) keeps this transform allocation-free.
    seriesByChannel: snapshot.seriesByChannel,
    x,
  };
}

/**
 * Folds the chronological (already decimated) window into a fixed BioSemi-style
 * sweep page: time becomes phase within the page (t mod window) and the arrays
 * are rotated at the cycle boundary so x stays ascending — uPlot requires a
 * monotonic x axis. The newest data lands at the end of the "new cycle" run;
 * the tail of the previous cycle follows at the higher phases. The vertical
 * connection at the cursor (newest/oldest share the same phase) is hidden by
 * the opaque erase band the panel paints in its draw hook.
 */
export function toSweepPageData(
  input: {
    x: Float64Array;
    seriesByChannel: Record<string, Float32Array>;
  },
  timeWindowSeconds: number,
  markers: EegMarker[] = [],
): SweepPageData {
  const safeWindowSeconds = Math.max(0.1, timeWindowSeconds);
  const eraseGapSeconds = sweepEraseGapSeconds(safeWindowSeconds);
  const length = input.x.length;

  const phases = new Float64Array(length);
  let rotationStart = -1;
  for (let index = 0; index < length; index += 1) {
    const phase = input.x[index] % safeWindowSeconds;
    phases[index] = phase;
    if (rotationStart === -1 && index > 0 && phase < phases[index - 1]) {
      rotationStart = index;
    }
  }
  const start = rotationStart === -1 ? 0 : rotationStart;
  const tailLength = length - start;

  const x = new Float64Array(length);
  x.set(phases.subarray(start, length), 0);
  if (start > 0) {
    x.set(phases.subarray(0, start), tailLength);
  }

  const seriesByChannel: Record<string, Float32Array> = {};
  for (const channelId of Object.keys(input.seriesByChannel)) {
    const values = input.seriesByChannel[channelId];
    const rotated = new Float32Array(length);
    rotated.set(values.subarray(start, length), 0);
    if (start > 0) {
      rotated.set(values.subarray(0, start), tailLength);
    }
    seriesByChannel[channelId] = rotated;
  }

  const cursorX = length > 0 ? phases[length - 1] : 0;
  const pageMarkers = markers
    .map((marker) => ({ ...marker, timeSeconds: marker.timeSeconds % safeWindowSeconds }))
    // A marker inside the erase band is being overwritten right now; the rest
    // of the previous cycle stays visible until the band reaches it.
    .filter((marker) => {
      const distanceAhead = (marker.timeSeconds - cursorX + safeWindowSeconds) % safeWindowSeconds;
      return distanceAhead > eraseGapSeconds;
    });

  return {
    cursorX,
    eraseGapSeconds,
    x,
    seriesByChannel,
    markers: pageMarkers,
  };
}
