import { describe, expect, it } from 'vitest';
import { shouldBypassRecordingConfirm } from './navigationGuards';

describe('shouldBypassRecordingConfirm', () => {
  it('bypasses only for the wizard route while its regulation window is open', () => {
    expect(shouldBypassRecordingConfirm('/effect-evaluation', true)).toBe(true);
  });

  it('still confirms for the wizard route when no regulation window is live', () => {
    expect(shouldBypassRecordingConfirm('/effect-evaluation', false)).toBe(false);
  });

  it('still confirms for every other route during a live window', () => {
    expect(shouldBypassRecordingConfirm('/music-regulation', true)).toBe(false);
    expect(shouldBypassRecordingConfirm('/home', true)).toBe(false);
  });
});
