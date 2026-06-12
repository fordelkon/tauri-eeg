import { describe, expect, it } from 'vitest';
import { DEFAULT_EEG_CHANNELS } from './channels';
import { EegRingBuffer } from './eegRingBuffer';
import type { EegSampleBlockPayload, EegTriggerCode } from './types';

const makePayload = (
  sequence: number,
  startedAtMs: number,
  samples: number[][],
  triggerClass?: EegTriggerCode | null,
): EegSampleBlockPayload => ({
  sequence,
  sampleRateHz: 2,
  startedAtMs,
  channelIds: DEFAULT_EEG_CHANNELS.slice(0, samples.length).map((channel) => channel.id),
  samples,
  triggerClass,
});

describe('EegRingBuffer', () => {
  it('keeps only samples inside the configured time window', () => {
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 2), 2);

    buffer.appendPayload(makePayload(1, 0, [[1, 2], [10, 20]]));
    buffer.appendPayload(makePayload(2, 1000, [[3, 4], [30, 40]]));
    buffer.appendPayload(makePayload(3, 2000, [[5, 6], [50, 60]]));

    const snapshot = buffer.toDisplayData(new Set(['ch01', 'ch02']), 2);

    expect(snapshot.x).toEqual([1, 1.5, 2, 2.5]);
    expect(snapshot.seriesByChannel.ch01).toEqual([3, 4, 5, 6]);
    expect(snapshot.seriesByChannel.ch02).toEqual([30, 40, 50, 60]);
  });

  it('preserves configured channel order when extracting visible channels', () => {
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 3), 2);

    buffer.appendPayload(makePayload(1, 0, [[1, 2], [10, 20], [100, 200]]));

    const snapshot = buffer.toDisplayData(new Set(['ch03', 'ch01']), 5);

    expect(snapshot.visibleChannels.map((channel) => channel.id)).toEqual(['ch01', 'ch03']);
  });

  it('clears all retained samples on reset', () => {
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 1), 2);

    buffer.appendPayload(makePayload(1, 0, [[1, 2]]));
    buffer.reset();

    const snapshot = buffer.toDisplayData(new Set(['ch01']), 5);

    expect(snapshot.x).toEqual([]);
    expect(snapshot.seriesByChannel.ch01).toEqual([]);
  });

  it('keeps sparse trigger markers inside the configured time window', () => {
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 1), 2);

    buffer.appendPayload(makePayload(1, 0, [[1, 2]], 255));
    buffer.appendPayload(makePayload(2, 1000, [[3, 4]], null));
    buffer.appendPayload(makePayload(3, 2000, [[5, 6]], 2));

    const snapshot = buffer.toDisplayData(new Set(['ch01']), 2);

    expect(snapshot.markers).toEqual([{ timeSeconds: 2, classId: 2 }]);
  });
});
