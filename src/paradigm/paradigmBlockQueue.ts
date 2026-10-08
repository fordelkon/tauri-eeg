import type { ParadigmTrialPlanItem } from './types';

/**
 * Pure block-queue math for the paradigm runner: emotion-block boundaries,
 * the per-block video number, and the derived progress view-model the runner
 * renders (block gate, counters). Kept free of React so the gate arithmetic
 * stays unit-testable in the node vitest environment.
 */

/** Indices where a new emotion block starts (index 0 always starts one). */
export function toBlockStarts(queue: ParadigmTrialPlanItem[]): number[] {
  const starts: number[] = [];
  queue.forEach((item, index) => {
    if (index === 0 || item.emotion !== queue[index - 1].emotion) {
      starts.push(index);
    }
  });
  return starts;
}

/** 1-based position of a trial inside its emotion block. */
export function videoNumberFor(trialIndex: number, blockStarts: number[]): number {
  let start = 0;
  for (const candidate of blockStarts) {
    if (candidate <= trialIndex) {
      start = candidate;
    }
  }
  return trialIndex - start + 1;
}

export type ParadigmQueueProgress = {
  blockStarts: number[];
  blockCount: number;
  /** 1-based index of the block the current (or next) trial belongs to. */
  currentBlockNumber: number;
  nextTrialIndex: number;
  /** Trial index where the next block starts, if the next trial opens one. */
  pendingBlockStart: number | null;
  /** True when the next trial opens a block the operator has not dismissed. */
  awaitingBlockGate: boolean;
  /** Number of blocks fully finished before the pending gate. */
  completedBlockCount: number;
  /** 1-based video number of the current trial (1 before the first trial). */
  currentVideoNumber: number;
  /** 1-based video number of the upcoming trial. */
  upcomingVideoNumber: number;
};

/**
 * Derived progress for the runner render and the auto-begin gate, computed
 * from the queue plus the two interactive inputs (current trial, dismissed
 * block gate). `currentTrialIndex` may be -1 before the first trial starts.
 */
export function describeParadigmQueueProgress(
  queue: ParadigmTrialPlanItem[],
  currentTrialIndex: number,
  blockGate: number,
): ParadigmQueueProgress {
  const blockStarts = toBlockStarts(queue);
  const blockCount = blockStarts.length;
  const currentBlockNumber = blockStarts.filter(
    (start) => start <= Math.max(currentTrialIndex, 0),
  ).length || 1;
  const nextTrialIndex = currentTrialIndex + 1;
  const pendingBlockStart = (
    nextTrialIndex > 0
    && nextTrialIndex < queue.length
    && blockStarts.includes(nextTrialIndex)
  )
    ? nextTrialIndex
    : null;
  const awaitingBlockGate = pendingBlockStart !== null && blockGate !== pendingBlockStart;
  const completedBlockCount = pendingBlockStart !== null
    ? blockStarts.filter((start) => start < pendingBlockStart).length
    : 0;
  const currentVideoNumber = currentTrialIndex >= 0
    ? videoNumberFor(currentTrialIndex, blockStarts)
    : 1;
  const upcomingVideoNumber = videoNumberFor(nextTrialIndex, blockStarts);

  return {
    blockStarts,
    blockCount,
    currentBlockNumber,
    nextTrialIndex,
    pendingBlockStart,
    awaitingBlockGate,
    completedBlockCount,
    currentVideoNumber,
    upcomingVideoNumber,
  };
}
