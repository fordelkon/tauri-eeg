import { describe, expect, it } from 'vitest';
import { EEG_RENDER_FRAME_INTERVAL_MS, shouldRenderEegFrame } from './eegRenderClock';

describe('shouldRenderEegFrame', () => {
  it('targets a ~15 Hz render cadence for the sweep-page display', () => {
    expect(EEG_RENDER_FRAME_INTERVAL_MS).toBe(66);
  });

  it('allows the first frame immediately', () => {
    expect(shouldRenderEegFrame(0, null, 66)).toBe(true);
  });

  it('skips frames until the minimum frame interval has elapsed', () => {
    expect(shouldRenderEegFrame(65, 0, 66)).toBe(false);
    expect(shouldRenderEegFrame(66, 0, 66)).toBe(true);
  });
});
