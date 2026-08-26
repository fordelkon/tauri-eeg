import { describe, expect, it } from 'vitest';
import {
  buildBatchReportPayload,
  buildSingleReportPayload,
  DEFAULT_EXPORT_FORMAT,
  resolveExportFormat,
  slugifySubjectForFile,
  suggestReportFileName,
} from './effectReportExport';

/**
 * The report-export buttons assemble their invoke payloads and save-dialog
 * defaults through these pure helpers — pinned here without Tauri or DOM.
 */

describe('resolveExportFormat', () => {
  it('accepts csv case-insensitively and clamps everything else to json', () => {
    expect(resolveExportFormat('csv')).toBe('csv');
    expect(resolveExportFormat(' CSV ')).toBe('csv');
    expect(resolveExportFormat('json')).toBe('json');
    expect(resolveExportFormat(undefined)).toBe(DEFAULT_EXPORT_FORMAT);
    expect(resolveExportFormat(null)).toBe(DEFAULT_EXPORT_FORMAT);
    // Unknown hints fall back instead of reaching the backend.
    expect(resolveExportFormat('xlsx')).toBe(DEFAULT_EXPORT_FORMAT);
    expect(resolveExportFormat('')).toBe(DEFAULT_EXPORT_FORMAT);
  });
});

describe('buildSingleReportPayload (导出 payload 组装)', () => {
  it('assembles a trimmed camelCase single payload with the default format', () => {
    expect(buildSingleReportPayload({
      baselineRecordId: ' rec-b ',
      postRecordId: ' rec-p ',
      path: ' C:/reports/r.json ',
    })).toEqual({
      kind: 'single',
      path: 'C:/reports/r.json',
      format: 'json',
      baselineRecordId: 'rec-b',
      postRecordId: 'rec-p',
    });
  });

  it('passes an explicit csv format through to the backend', () => {
    const payload = buildSingleReportPayload({
      baselineRecordId: 'rec-b',
      postRecordId: 'rec-p',
      path: 'C:/reports/r.csv',
      format: 'csv',
    });
    expect(payload.format).toBe('csv');
  });

  it('rejects blank record ids with the phase named', () => {
    expect(() => buildSingleReportPayload({
      baselineRecordId: null,
      postRecordId: 'rec-p',
      path: 'C:/r.json',
    })).toThrow('基线');

    expect(() => buildSingleReportPayload({
      baselineRecordId: 'rec-b',
      postRecordId: '   ',
      path: 'C:/r.json',
    })).toThrow('调控后');
  });

  it('rejects an empty save path', () => {
    expect(() => buildSingleReportPayload({
      baselineRecordId: 'rec-b',
      postRecordId: 'rec-p',
      path: '',
    })).toThrow('保存路径');
  });
});

describe('buildBatchReportPayload', () => {
  it('carries only the batch kind and the validated path', () => {
    expect(buildBatchReportPayload({ path: ' D:/汇总.csv ' })).toEqual({
      kind: 'batch',
      path: 'D:/汇总.csv',
    });

    expect(() => buildBatchReportPayload({ path: null })).toThrow('保存路径');
  });
});

describe('suggestReportFileName', () => {
  const noon = new Date(2026, 7, 26, 9, 5); // local components → 20260826-0905

  it('builds a dated single-report name per format', () => {
    expect(suggestReportFileName({
      kind: 'single',
      format: 'json',
      subjectId: 'subj-001',
      now: noon,
    })).toBe('effect-report-subj-001-20260826-0905.json');

    expect(suggestReportFileName({
      kind: 'single',
      format: 'csv',
      subjectId: 'subj-001',
      now: noon,
    })).toBe('effect-report-subj-001-20260826-0905.csv');
  });

  it('builds the all-subjects batch summary name as csv', () => {
    expect(suggestReportFileName({ kind: 'batch', now: noon }))
      .toBe('effect-summary-all-20260826-0905.csv');
  });

  it('falls back to a generic subject fragment when none was configured', () => {
    expect(suggestReportFileName({ kind: 'single', subjectId: '', now: noon }))
      .toContain('effect-report-subject-');
  });
});

describe('slugifySubjectForFile', () => {
  it('keeps readable ids and CJK intact', () => {
    expect(slugifySubjectForFile('subj-001')).toBe('subj-001');
    expect(slugifySubjectForFile('被试 07')).toBe('被试-07');
  });

  it('strips characters that are illegal in file names', () => {
    expect(slugifySubjectForFile('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(slugifySubjectForFile('  spaced  id  ')).toBe('spaced-id');
    expect(slugifySubjectForFile('.hidden.')).toBe('hidden');
  });

  it('caps the length and never returns an empty fragment', () => {
    expect(slugifySubjectForFile('x'.repeat(100))).toHaveLength(40);
    expect(slugifySubjectForFile(null)).toBe('subject');
    expect(slugifySubjectForFile('///')).toBe('subject');
  });
});
