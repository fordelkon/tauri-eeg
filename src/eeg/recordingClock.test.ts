import { describe, expect, it } from 'vitest';
import {
  formatRecordingClock,
  resolvedRecordingDurationSeconds,
} from './recordingClock';

describe('formatRecordingClock', () => {
  it('formats sub-hour durations as mm:ss', () => {
    expect(formatRecordingClock(0)).toBe('00:00');
    expect(formatRecordingClock(5)).toBe('00:05');
    expect(formatRecordingClock(65)).toBe('01:05');
    expect(formatRecordingClock(3599)).toBe('59:59');
  });

  it('prepends hours once the duration passes one hour', () => {
    expect(formatRecordingClock(3600)).toBe('1:00:00');
    expect(formatRecordingClock(3661)).toBe('1:01:01');
    expect(formatRecordingClock(7325)).toBe('2:02:05');
  });

  it('floors fractional seconds and clamps negatives to zero', () => {
    expect(formatRecordingClock(12.9)).toBe('00:12');
    expect(formatRecordingClock(-4)).toBe('00:00');
  });
});

describe('resolvedRecordingDurationSeconds', () => {
  it('prefers the backend-computed duration', () => {
    const session = {
      durationSeconds: 125.4,
      startedAt: '2026-08-25T10:00:00Z',
      endedAt: null,
    };

    expect(resolvedRecordingDurationSeconds(session)).toBe(125.4);
  });

  it('falls back to the start/end timestamps when duration is missing', () => {
    const session = {
      durationSeconds: null,
      startedAt: '2026-08-25T10:00:00Z',
      endedAt: '2026-08-25T10:02:30Z',
    };

    expect(resolvedRecordingDurationSeconds(session)).toBe(150);
  });

  it('returns null when neither duration nor a parseable end time exists', () => {
    expect(resolvedRecordingDurationSeconds({
      durationSeconds: null,
      startedAt: '2026-08-25T10:00:00Z',
      endedAt: null,
    })).toBeNull();

    expect(resolvedRecordingDurationSeconds({
      durationSeconds: null,
      startedAt: 'not-a-date',
      endedAt: 'also-not-a-date',
    })).toBeNull();
  });
});
