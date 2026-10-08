import { describe, expect, it } from 'vitest';
import {
  describeParadigmQueueProgress,
  toBlockStarts,
  videoNumberFor,
} from './paradigmBlockQueue';
import type { ParadigmTrialPlanItem } from './types';

function plan(trialIndex: number, emotion: ParadigmTrialPlanItem['emotion']): ParadigmTrialPlanItem {
  return {
    emotion,
    trialIndex,
    videoId: `video-${trialIndex}`,
    videoPath: `/videos/video-${trialIndex}.mp4`,
  } as ParadigmTrialPlanItem;
}

// Two blocks: 2 anxious trials followed by 2 calm ones.
const queue = [
  plan(0, 'anxiety'),
  plan(1, 'anxiety'),
  plan(2, 'calm'),
  plan(3, 'calm'),
];

describe('paradigm block queue', () => {
  it('block starts mark the first trial of each emotion run', () => {
    expect(toBlockStarts(queue)).toEqual([0, 2]);
    expect(toBlockStarts([])).toEqual([]);
  });

  it('video numbering restarts at each block boundary', () => {
    const starts = toBlockStarts(queue);
    expect(videoNumberFor(0, starts)).toBe(1);
    expect(videoNumberFor(1, starts)).toBe(2);
    expect(videoNumberFor(2, starts)).toBe(1);
    expect(videoNumberFor(3, starts)).toBe(2);
  });

  it('progress derives the block gate between blocks', () => {
    // Before the first trial: no gate pending.
    expect(describeParadigmQueueProgress(queue, -1, -1)).toMatchObject({
      blockCount: 2,
      currentBlockNumber: 1,
      currentVideoNumber: 1,
      upcomingVideoNumber: 1,
      pendingBlockStart: null,
      awaitingBlockGate: false,
      completedBlockCount: 0,
    });

    // Both trials of block 1 done → the next trial opens block 2 → gate holds it.
    const progress = describeParadigmQueueProgress(queue, 1, -1);
    expect(progress).toMatchObject({
      nextTrialIndex: 2,
      pendingBlockStart: 2,
      awaitingBlockGate: true,
      completedBlockCount: 1,
      currentVideoNumber: 2,
      upcomingVideoNumber: 1,
    });

    // Operator dismisses the gate for block 2 → auto-begin may proceed.
    expect(describeParadigmQueueProgress(queue, 1, 2)).toMatchObject({
      pendingBlockStart: 2,
      awaitingBlockGate: false,
    });

    // Inside block 2: no further gate, numbering restarted.
    expect(describeParadigmQueueProgress(queue, 2, -1)).toMatchObject({
      currentBlockNumber: 2,
      currentVideoNumber: 1,
      upcomingVideoNumber: 2,
      pendingBlockStart: null,
    });
  });
});
