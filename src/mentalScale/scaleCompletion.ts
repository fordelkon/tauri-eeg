import type { MentalScalePath } from './mentalScaleGate';

/**
 * Session-scoped completion bookkeeping for the mental-scale gate.
 *
 * The gate used to prompt on every navigation into a regulation page while
 * remaining fully bypassable via direct URL entry. Both defects are fixed by
 * tracking per-path completions here: the sidebar flow grants a grace window
 * for recent completions, and the route-level guard consults the same state,
 * so a URL entered directly still meets the gate exactly once per window.
 */
export const SCALE_GRACE_PERIOD_MS = 30 * 60 * 1000;

type ScaleCompletionStore = {
  completions: Map<MentalScalePath, number>;
  skips: Set<MentalScalePath>;
};

export const createScaleCompletionStore = () => {
  const store: ScaleCompletionStore = {
    completions: new Map(),
    skips: new Set(),
  };

  return {
    record(path: MentalScalePath, now = Date.now()) {
      store.completions.set(path, now);
      store.skips.delete(path);
    },
    recordSkip(path: MentalScalePath) {
      store.skips.add(path);
    },
    isSatisfied(path: MentalScalePath, now = Date.now()): boolean {
      if (store.skips.has(path)) {
        return true;
      }

      const completedAt = store.completions.get(path);

      return completedAt !== undefined && now - completedAt < SCALE_GRACE_PERIOD_MS;
    },
    reset() {
      store.completions.clear();
      store.skips.clear();
    },
  };
};

export type ScaleCompletion = ReturnType<typeof createScaleCompletionStore>;

const globalStore = createScaleCompletionStore();

export const scaleCompletion = globalStore;

export function recordScaleCompletion(path: MentalScalePath, now?: number): void {
  globalStore.record(path, now);
}

export function recordScaleSkip(path: MentalScalePath): void {
  globalStore.recordSkip(path);
}

export function isScaleSatisfiedForPath(path: MentalScalePath, now?: number): boolean {
  return globalStore.isSatisfied(path, now);
}

export function resetScaleCompletionForTests(): void {
  globalStore.reset();
}
