import { beforeEach, describe, expect, it } from 'vitest';
import {
  SCALE_GRACE_PERIOD_MS,
  createScaleCompletionStore,
} from './scaleCompletion';

const T0 = 1_700_000_000_000;
const MIN = 60 * 1000;

describe('scaleCompletionStore', () => {
  let store: ReturnType<typeof createScaleCompletionStore>;

  beforeEach(() => {
    store = createScaleCompletionStore();
  });

  it('is unsatisfied before any completion or skip', () => {
    expect(store.isSatisfied('/video-regulation', T0)).toBe(false);
  });

  it('keeps the grace window open at 29 minutes and closes it at 30', () => {
    store.record('/video-regulation', T0);

    expect(store.isSatisfied('/video-regulation', T0 + 29 * MIN)).toBe(true);
    // Boundary: exactly one full grace period has elapsed — gate re-arms.
    expect(T0 + 30 * MIN - T0).toBe(SCALE_GRACE_PERIOD_MS);
    expect(store.isSatisfied('/video-regulation', T0 + SCALE_GRACE_PERIOD_MS)).toBe(false);
    expect(store.isSatisfied('/video-regulation', T0 + 31 * MIN)).toBe(false);
  });

  it('tracks each path independently', () => {
    store.record('/video-regulation', T0);

    expect(store.isSatisfied('/video-regulation', T0 + 1000)).toBe(true);
    expect(store.isSatisfied('/game-regulation', T0 + 1000)).toBe(false);
  });

  it('skip lifts the gate once and a fresh completion replaces it', () => {
    store.recordSkip('/music-regulation');
    expect(store.isSatisfied('/music-regulation', T0)).toBe(true);

    // A real completion supersedes the skip and starts its own grace window.
    store.record('/music-regulation', T0);
    expect(store.isSatisfied('/music-regulation', T0 + 29 * MIN)).toBe(true);
    expect(store.isSatisfied('/music-regulation', T0 + SCALE_GRACE_PERIOD_MS)).toBe(false);
  });

  it('consuming a skip re-arms the gate without touching completions', () => {
    store.recordSkip('/music-regulation');
    store.record('/video-regulation', T0);

    store.consumeSkip('/music-regulation');

    expect(store.isSatisfied('/music-regulation', T0)).toBe(false);
    // Consuming a pending skip on another path leaves that path's grace intact.
    expect(store.isSatisfied('/video-regulation', T0 + 1000)).toBe(true);
  });

  it('consuming a skip with none pending is a no-op', () => {
    store.record('/music-regulation', T0);
    store.consumeSkip('/music-regulation');

    expect(store.isSatisfied('/music-regulation', T0 + 1000)).toBe(true);
  });

  it('re-recording a skip after consumption satisfies the gate again', () => {
    store.recordSkip('/music-regulation');
    store.consumeSkip('/music-regulation');
    expect(store.isSatisfied('/music-regulation', T0)).toBe(false);

    store.recordSkip('/music-regulation');
    expect(store.isSatisfied('/music-regulation', T0)).toBe(true);
  });

  it('reset clears both completions and skips', () => {
    store.record('/video-regulation', T0);
    store.recordSkip('/game-regulation');
    store.reset();

    expect(store.isSatisfied('/video-regulation', T0)).toBe(false);
    expect(store.isSatisfied('/game-regulation', T0)).toBe(false);
  });
});
