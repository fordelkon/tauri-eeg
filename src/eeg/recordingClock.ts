import type { EegRecordingSession } from './types';

/**
 * mm:ss wall clock for recording durations; hours are prepended only once a
 * recording passes one hour (h:mm:ss) so short sessions stay compact.
 */
export function formatRecordingClock(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const seconds = safeSeconds % 60;
  const minutes = Math.floor(safeSeconds / 60) % 60;
  const hours = Math.floor(safeSeconds / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Duration shown after a recording stops: prefer the backend-computed value,
 * falling back to the start/end timestamps when it is missing.
 */
export function resolvedRecordingDurationSeconds(
  session: Pick<EegRecordingSession, 'durationSeconds' | 'startedAt' | 'endedAt'>,
): number | null {
  if (session.durationSeconds !== null && Number.isFinite(session.durationSeconds)) {
    return Math.max(0, session.durationSeconds);
  }

  if (!session.endedAt) {
    return null;
  }

  const startedAtMs = Date.parse(session.startedAt);
  const endedAtMs = Date.parse(session.endedAt);

  if (Number.isNaN(startedAtMs) || Number.isNaN(endedAtMs)) {
    return null;
  }

  return Math.max(0, (endedAtMs - startedAtMs) / 1000);
}
