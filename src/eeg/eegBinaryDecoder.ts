import type { EegDecodedSampleBlock } from './types';

/**
 * Binary sample-block wire format produced by the Rust aggregator
 * (little-endian):
 * - 0..4   u32 sequence
 * - 4..8   u32 sample rate (Hz)
 * - 8..16  u64 stream start time (ms since UNIX epoch)
 * - 16..18 u16 channel count
 * - 18..20 u16 sample count
 * - 20     u8 trigger present (0/1)
 * - 21     u8 trigger value
 * - 22..24 zero padding
 * - 24..   f32 x channel count x sample count, channel-major ([ch0 s0..sN][ch1 s0..sN]...)
 */
const HEADER_BYTES = 24;
const MAX_CHANNELS = 1024;
const MAX_SAMPLES_PER_BLOCK = 65536;

export function decodeEegSampleBlock(
  input: ArrayBuffer | Uint8Array,
): EegDecodedSampleBlock | null {
  const byteOffset = input instanceof Uint8Array ? input.byteOffset : 0;
  const byteLength = input instanceof Uint8Array ? input.byteLength : input.byteLength;
  if (byteLength < HEADER_BYTES) {
    return null;
  }

  const view = new DataView(
    input instanceof Uint8Array ? input.buffer : input,
    byteOffset,
    byteLength,
  );
  const channelCount = view.getUint16(16, true);
  const sampleCount = view.getUint16(18, true);
  if (
    channelCount === 0
    || channelCount > MAX_CHANNELS
    || sampleCount > MAX_SAMPLES_PER_BLOCK
  ) {
    return null;
  }

  const expectedBytes = HEADER_BYTES + channelCount * sampleCount * 4;
  if (byteLength < expectedBytes) {
    return null;
  }

  // Channel-major layout gives contiguous, zero-copy per-channel views when the
  // data is 4-byte aligned (an ArrayBuffer from IPC always is).
  const samples: Float32Array[] = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    const offset = byteOffset + HEADER_BYTES + channel * sampleCount * 4;
    if (offset % 4 === 0) {
      samples.push(new Float32Array(view.buffer, offset, sampleCount));
    } else {
      const values = new Float32Array(sampleCount);
      for (let index = 0; index < sampleCount; index += 1) {
        values[index] = view.getFloat32(offset + index * 4, true);
      }
      samples.push(values);
    }
  }

  return {
    sequence: view.getUint32(0, true),
    sampleRateHz: view.getUint32(4, true),
    startedAtMs: Number(view.getBigUint64(8, true)),
    triggerClass: view.getUint8(20) === 0 ? null : view.getUint8(21),
    samples,
  };
}
