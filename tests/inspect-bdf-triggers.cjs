// Read BioSemi 24-bit records without modifying the source BDF.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

function inspect(filename) {
  const fd = fs.openSync(filename, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const fixed = Buffer.alloc(256);
    assert.equal(fs.readSync(fd, fixed, 0, 256, 0), 256);
    assert.equal(fixed[0], 255);
    assert.equal(fixed.subarray(1, 8).toString(), 'BIOSEMI');
    const number = (buffer, start, length) => {
      const text = buffer.subarray(start, start + length).toString().trim();
      assert.notEqual(text, '');
      const value = Number(text);
      assert.ok(Number.isFinite(value), `Invalid numeric field at ${start}`);
      return value;
    };
    const channels = number(fixed, 252, 4);
    const headerBytes = number(fixed, 184, 8);
    const declaredRecords = number(fixed, 236, 8);
    const recordSeconds = number(fixed, 244, 8);
    assert.ok(Number.isInteger(channels) && channels > 0 && channels < 4096);
    assert.equal(headerBytes, (channels + 1) * 256);
    assert.ok(recordSeconds > 0);
    const header = Buffer.alloc(headerBytes);
    assert.equal(fs.readSync(fd, header, 0, headerBytes, 0), headerBytes);
    const labels = Array.from({ length: channels }, (_, i) =>
      header.subarray(256 + i * 16, 256 + (i + 1) * 16).toString().trim());
    const statusIndex = labels.findIndex(label => /^status$/i.test(label));
    assert.ok(statusIndex >= 0, 'No Status channel');
    const samples = Array.from({ length: channels }, (_, i) => number(header, 256 + channels * 216 + i * 8, 8));
    assert.ok(samples.every(n => Number.isInteger(n) && n > 0));
    const recordBytes = samples.reduce((sum, n) => sum + n * 3, 0);
    const availableRecords = Math.floor((size - headerBytes) / recordBytes);
    const trailingBytes = (size - headerBytes) % recordBytes;
    const statusOffset = samples.slice(0, statusIndex).reduce((sum, n) => sum + n * 3, 0);
    const rate = samples[statusIndex] / recordSeconds;
    const buffer = Buffer.alloc(samples[statusIndex] * 3);
    const counts = { low: {}, high: {}, status: {} };
    const events = [];
    let previous = null;
    let active = null;
    let sample = 0;
    let nonzeroToNonzero = 0;
    const finish = end => {
      if (!active) return;
      active.widthSamples = end - active.sample;
      active.widthMs = active.widthSamples / rate * 1000;
      events.push(active);
      active = null;
    };
    for (let record = 0; record < availableRecords; record++) {
      assert.equal(fs.readSync(fd, buffer, 0, buffer.length,
        headerBytes + record * recordBytes + statusOffset), buffer.length);
      for (let offset = 0; offset < buffer.length; offset += 3, sample++) {
        const low = buffer[offset];
        const high = buffer[offset + 1];
        const status = buffer[offset + 2];
        for (const [field, value] of [['low', low], ['high', high], ['status', status]]) {
          counts[field][value] = (counts[field][value] || 0) + 1;
        }
        if (low !== previous) {
          if (previous > 0 && low > 0) nonzeroToNonzero++;
          finish(sample);
          if (low > 0) active = { code: low, sample, seconds: sample / rate,
            highByteAtOnset: high, statusByteAtOnset: status,
            startsAtFileBoundary: sample === 0 };
          previous = low;
        }
      }
    }
    if (active) { active.endsAtFileBoundary = true; finish(sample); }
    const source = fs.readFileSync(path.resolve(__dirname, '../src-tauri/src/experiment/types.rs'), 'utf8');
    const mapping = Object.fromEntries([...source.matchAll(/\("([a-z_]+)",\s*(\d+)\)/g)]
      .map(match => [Number(match[2]), match[1]]));
    mapping[254] = 'trigger_test';
    for (const event of events) event.event = mapping[event.code] || 'unmapped';
    return { file: path.resolve(filename), size, fileSizeChangedDuringRead: fs.fstatSync(fd).size !== size,
      startDate: fixed.subarray(168, 176).toString().trim(),
      startTime: fixed.subarray(176, 184).toString().trim(),
      channels, labels, headerBytes, declaredRecords, availableRecords, trailingBytes,
      recordBytes, recordSeconds, sampleRate: rate, durationSeconds: sample / rate,
      nonzeroToNonzero, counts, events };
  } finally { fs.closeSync(fd); }
}

if (require.main === module) {
  const [filename, output] = process.argv.slice(2);
  if (!filename) throw new Error('Usage: node tests/inspect-bdf-triggers.cjs input.bdf [report.json]');
  const report = inspect(filename);
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
}
module.exports = { inspect };
