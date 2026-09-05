/**
 * Buffered thinking-delta accumulator for the agent panel's streaming display:
 * deltas land in a local buffer and are flushed onto the last thinking step at
 * a 100ms cadence, so a fast token stream re-renders the panel per chunk
 * instead of per token. Plain closure state — no React — so the hook owns a
 * single instance for its whole lifetime.
 */

const THINKING_FLUSH_INTERVAL_MS = 100;

export type ThinkingBuffer = {
  append: (delta: string) => void;
  flush: () => void;
  /** Cancels a pending flush (the hook's unmount cleanup). */
  dispose: () => void;
};

export function createThinkingBuffer(
  setThinkingSteps: (update: (currentSteps: string[]) => string[]) => void,
): ThinkingBuffer {
  let buffer = '';
  let flushTimer: number | null = null;

  const flush = () => {
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }

    if (buffer.length === 0) {
      return;
    }

    const bufferedDelta = buffer;
    buffer = '';
    setThinkingSteps((currentSteps) => {
      const nextSteps = currentSteps.length > 0 ? [...currentSteps] : [''];
      nextSteps[nextSteps.length - 1] = `${nextSteps[nextSteps.length - 1]}${bufferedDelta}`;
      return nextSteps;
    });
  };

  const append = (delta: string) => {
    buffer += delta;
    if (flushTimer === null) {
      flushTimer = window.setTimeout(() => {
        flushTimer = null;
        flush();
      }, THINKING_FLUSH_INTERVAL_MS);
    }
  };

  const dispose = () => {
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
  };

  return { append, flush, dispose };
}
