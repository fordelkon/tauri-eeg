import { describe, expect, it } from 'vitest';
import { shouldRenderEegFrame } from './eegRenderClock';

describe('shouldRenderEegFrame', () => {
  it('allows the first frame immediately', () => {
    expect(shouldRenderEegFrame(0, null, 33)).toBe(true);
  });

  it('skips frames until the minimum frame interval has elapsed', () => {
    expect(shouldRenderEegFrame(32, 0, 33)).toBe(false);
    expect(shouldRenderEegFrame(33, 0, 33)).toBe(true);
  });
});
