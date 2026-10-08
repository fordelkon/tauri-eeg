const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { inspect } = require('./inspect-bdf-triggers.cjs');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bdf-reader-'));
const filename = path.join(directory, 'fixture.bdf');
try {
  const header = Buffer.alloc(768, 32);
  const field = (offset, width, value) => header.write(String(value).padEnd(width), offset, width, 'ascii');
  header[0] = 255;
  header.write('BIOSEMI', 1);
  field(168, 8, '08.10.26');
  field(176, 8, '18.00.00');
  field(184, 8, 768);
  field(236, 8, 2);
  field(244, 8, 1);
  field(252, 4, 2);
  field(256, 16, 'A1');
  field(272, 16, 'Status');
  field(256 + 2 * 216, 8, 8);
  field(256 + 2 * 216 + 8, 8, 8);
  const data = Buffer.alloc(96);
  const codes = [0, 254, 254, 0, 60, 60, 0, 31, 31, 0, 61, 0, 0, 0, 0, 0];
  codes.forEach((code, i) => {
    const offset = Math.floor(i / 8) * 48 + 24 + i % 8 * 3;
    data[offset] = code;
    data[offset + 1] = 170;
    data[offset + 2] = i % 2 ? 152 : 136;
  });
  fs.writeFileSync(filename, Buffer.concat([header, data]));
  const report = inspect(filename);
  assert.equal(report.availableRecords, 2);
  assert.equal(report.sampleRate, 8);
  assert.equal(report.durationSeconds, 2);
  assert.equal(report.trailingBytes, 0);
  assert.deepEqual(report.events.map(e => [e.code, e.sample, e.widthSamples]),
    [[254, 1, 2], [60, 4, 2], [31, 7, 2], [61, 10, 1]]);
  assert.equal(report.events[2].event, 'music_regulation_start');
  assert.equal(report.counts.high[170], 16);
  console.log('Passed: 24-bit channel layout, low-byte masking, status flag changes, cross-record pulses, code mapping.');
} finally {
  fs.unlinkSync(filename);
  fs.rmdirSync(directory);
}
