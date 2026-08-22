import { describe, expect, it } from 'vitest';
import { decodeEegSampleBlock } from './eegBinaryDecoder';

function encodeBlock(options: {
  sequence?: number;
  sampleRateHz?: number;
  startedAtMs?: number;
  channels?: number;
  samplesPerChannel?: number[];
  triggerClass?: number | null;
}) {
  const channels = options.channels ?? 2;
  const samplesPerChannel = options.samplesPerChannel ?? [1, -2.5];
  const sampleCount = samplesPerChannel.length;
  const bytes = new Uint8Array(24 + 4 * channels * sampleCount);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, options.sequence ?? 7, true);
  view.setUint32(4, options.sampleRateHz ?? 1000, true);
  view.setBigUint64(8, BigInt(options.startedAtMs ?? 1_700_000_000_000), true);
  view.setUint16(16, channels, true);
  view.setUint16(18, sampleCount, true);
  const hasTrigger = options.triggerClass != null;
  view.setUint8(20, hasTrigger ? 1 : 0);
  if (hasTrigger) {
    view.setUint8(21, options.triggerClass as number);
  }
  for (let channel = 0; channel < channels; channel += 1) {
    for (let index = 0; index < sampleCount; index += 1) {
      const value = channel === 0 ? samplesPerChannel[index] : samplesPerChannel[index] * 10;
      view.setFloat32(24 + (channel * sampleCount + index) * 4, value, true);
    }
  }
  return bytes.buffer;
}

describe('decodeEegSampleBlock', () => {
  it('decodes the header and channel-major samples without copies', () => {
    const block = decodeEegSampleBlock(encodeBlock({
      sequence: 7,
      sampleRateHz: 1000,
      startedAtMs: 1_700_000_000_000,
      channels: 2,
      samplesPerChannel: [1, -2.5],
      triggerClass: 2,
    }));

    expect(block).not.toBeNull();
    expect(block?.sequence).toBe(7);
    expect(block?.sampleRateHz).toBe(1000);
    expect(block?.startedAtMs).toBe(1_700_000_000_000);
    expect(block?.triggerClass).toBe(2);
    expect(block?.samples).toHaveLength(2);
    expect(Array.from(block?.samples[0] ?? [])).toEqual([1, -2.5]);
    expect(Array.from(block?.samples[1] ?? [])).toEqual([10, -25]);
    expect(block?.samples[0]).toBeInstanceOf(Float32Array);
  });

  it('reports a null trigger when the present flag is zero', () => {
    const block = decodeEegSampleBlock(encodeBlock({ triggerClass: null }));

    expect(block?.triggerClass).toBeNull();
  });

  it('returns null for truncated or malformed blocks', () => {
    expect(decodeEegSampleBlock(new ArrayBuffer(8))).toBeNull();
    expect(decodeEegSampleBlock(new ArrayBuffer(24))).toBeNull();

    // Header claims 2 channels x 2 samples (40 bytes) but the buffer is short.
    const truncated = new DataView(new ArrayBuffer(24 + 8));
    truncated.setUint16(16, 2, true);
    truncated.setUint16(18, 2, true);
    expect(decodeEegSampleBlock(truncated.buffer)).toBeNull();

    const zeroChannels = new DataView(new ArrayBuffer(24));
    zeroChannels.setUint16(16, 0, true);
    zeroChannels.setUint16(18, 0, true);
    expect(decodeEegSampleBlock(zeroChannels.buffer)).toBeNull();
  });
});
