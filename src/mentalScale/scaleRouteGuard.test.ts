import { beforeEach, describe, expect, it } from 'vitest';
import { getMentalScaleForPath } from './mentalScaleGate';
import {
  isScaleSatisfiedForPath,
  recordScaleCompletion,
  recordScaleSkip,
  resetScaleCompletionForTests,
} from './scaleCompletion';

/**
 * Route-level smoke contract for ScaleGateRoute: the component renders
 * <Outlet/> exactly when `getMentalScaleForPath(pathname)` returns null OR
 * `isScaleSatisfiedForPath(scale.path)` is true. These tests pin that decision
 * so a URL typed directly into a gated page cannot silently bypass the scale.
 */
describe('ScaleGateRoute access decision', () => {
  beforeEach(() => {
    resetScaleCompletionForTests();
  });

  it('blocks a gated regulation page until the scale is answered or skipped', () => {
    const scale = getMentalScaleForPath('/video-regulation');
    expect(scale).not.toBeNull();
    // No completion, no skip -> guard must NOT render Outlet.
    expect(gateDecision(scale!.path)).toBe('gate');
  });

  it('opens non-regulation routes without any gate', () => {
    expect(getMentalScaleForPath('/home')).toBeNull();
    expect(getMentalScaleForPath('/paradigm')).toBeNull();
  });

  it('lets a skipped user through for this attempt via the same decision', () => {
    const scale = getMentalScaleForPath('/music-regulation');
    expect(scale).not.toBeNull();

    recordScaleSkip(scale!.path);
    expect(gateDecision(scale!.path)).toBe('open');
  });

  it('opens once the scale has been completed inside the grace window', () => {
    const scale = getMentalScaleForPath('/game-regulation');
    expect(scale).not.toBeNull();

    recordScaleCompletion(scale!.path);
    expect(gateDecision(scale!.path)).toBe('open');
  });
});

/** Mirrors ScaleGateRoute's render branch without needing a DOM. */
function gateDecision(path: '/video-regulation' | '/game-regulation' | '/music-regulation'): 'open' | 'gate' {
  return isScaleSatisfiedForPath(path) ? 'open' : 'gate';
}
