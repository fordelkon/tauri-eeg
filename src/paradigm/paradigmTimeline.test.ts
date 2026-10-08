import { describe, expect, it } from 'vitest';
import { BASELINE_REST_MS, coalesceCountdownTickMs } from './paradigmTimeline';

describe('coalesceCountdownTickMs', () => {
  it('returns the stored value while the whole-second ceiling is unchanged', () => {
    const stored = 5000;
    expect(coalesceCountdownTickMs(stored, 4900)).toBe(stored);
    expect(coalesceCountdownTickMs(stored, 4001)).toBe(stored);
    // A later reading inside the same whole-second ceiling stays put.
    expect(coalesceCountdownTickMs(2600, 2900)).toBe(2600);
  });

  it('adopts the measured value exactly when the ceiling advances', () => {
    expect(coalesceCountdownTickMs(5000, 3999)).toBe(3999);
    expect(coalesceCountdownTickMs(3900, 2875)).toBe(2875);
    // Fractional milliseconds ride on the same ceiling.
    expect(coalesceCountdownTickMs(4500.4, 3499.9)).toBe(3499.9);
    expect(coalesceCountdownTickMs(3499.9, 2345)).toBe(2345);
  });

  it('keeps the displayed ceiling glued to wall-clock truth across a whole countdown', () => {
    // Simulate the renderer's tick loop (completion is handled outside the
    // helper when the measurement reaches zero). Every accepted update must
    // leave the stored value in the same whole-second cell as the true
    // remaining time — i.e. the rendered number never drifts from the
    // unthrottled pipeline's, it just updates less often.
    const durationMs = BASELINE_REST_MS;
    const tickMs = 100;
    let stored = durationMs;
    let updates = 0;

    for (let elapsedMs = tickMs; elapsedMs < durationMs; elapsedMs += tickMs) {
      const measured = durationMs - elapsedMs;
      const next = coalesceCountdownTickMs(stored, measured);
      if (next !== stored) {
        updates += 1;
        stored = next;
      }
      expect(Math.ceil(stored / 1000)).toBe(Math.ceil(measured / 1000));
    }

    // A 5 s countdown displays 5 -> 4 -> 3 -> 2 -> 1: four ceiling changes,
    // not one re-render per 100 ms tick.
    expect(updates).toBe(4);
  });
});
