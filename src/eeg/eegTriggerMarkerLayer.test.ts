import { describe, expect, it } from 'vitest';
import { TRIGGER_COLORS } from './EegWaveformPanel';
import { DEFAULT_EEG_CHANNELS } from './channels';
import { EegRingBuffer } from './eegRingBuffer';
import { PARADIGM_TRIGGER_CLASSES } from './paradigm/types';
import type { EegDecodedSampleBlock } from './types';

const makeBlock = (
  sequence: number,
  startedAtMs: number,
  samples: number[][],
  triggerClass?: number | null,
): EegDecodedSampleBlock => ({
  sequence,
  sampleRateHz: 2,
  startedAtMs,
  triggerClass: triggerClass ?? null,
  samples: samples.map((channel) => Float32Array.from(channel)),
});

/**
 * R9: R8 assigned fear to trigger slot 5 on the wire, but the live waveform
 * marker layer (MARKER_CLASSES / TRIGGER_COLORS) never learned the new code,
 * so a fear induction ran with no visible trigger on the acquisition page.
 * This locks code 5 (and every other scheduled class) into both layers.
 */
describe('live waveform trigger marker layer', () => {
  it('keeps the fear trigger code (5) visible like every other scheduled class', () => {
    // Ingest side: MARKER_CLASSES must admit the fear block, otherwise the
    // ring drops the marker before the panel ever sees it.
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 1), 2);

    buffer.appendPayload(makeBlock(1, 0, [[1, 2]], 5));

    const snapshot = buffer.toDisplayData(new Set(['ch01']), 2);
    expect(snapshot.markers).toEqual([{ timeSeconds: 0, classId: 5 }]);

    // Draw side: every scheduled paradigm class needs a color key so the
    // marker badge fills with a real color instead of the 0-default that
    // vanishes into the dark plot background.
    for (const classId of Object.values(PARADIGM_TRIGGER_CLASSES)) {
      expect(TRIGGER_COLORS[classId], `trigger code ${classId}`).toMatch(/^#[0-9a-f]{6}$/i);
    }

    // Distinct colors keep marker classes readable against each other.
    expect(new Set(Object.values(TRIGGER_COLORS)).size).toBe(Object.keys(TRIGGER_COLORS).length);
  });
});
