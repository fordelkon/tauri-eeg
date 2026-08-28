/**
 * Pure helpers behind the effect-report export buttons: invoke-payload
 * assembly and save-dialog defaults. Kept free of Tauri/DOM access so the
 * validation and naming rules stay unit-testable in the node vitest
 * environment; the caller owns the save dialog and the invoke itself.
 */

export type ExportReportFormat = 'json' | 'csv';

export const DEFAULT_EXPORT_FORMAT: ExportReportFormat = 'json';

/** Maps any operator/format hint onto the two formats the backend writes. */
export function resolveExportFormat(raw: string | null | undefined): ExportReportFormat {
  return raw?.trim().toLowerCase() === 'csv' ? 'csv' : DEFAULT_EXPORT_FORMAT;
}

export type SingleReportPayload = {
  kind: 'single';
  path: string;
  format: ExportReportFormat;
  baselineRecordId: string;
  postRecordId: string;
};

export type BatchReportPayload = {
  kind: 'batch';
  path: string;
};

export type ComparisonReportPayload = {
  kind: 'comparison';
  path: string;
  format: ExportReportFormat;
  subjectId: string;
  emotion: string;
};

export type ReportExportPayload =
  | SingleReportPayload
  | BatchReportPayload
  | ComparisonReportPayload;

const FORBIDDEN_FILE_CHARS = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|']);

function requireTrimmed(value: string | null | undefined, message: string): string {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}

/**
 * Assembles the `export_effect_report` payload for one run's report. Both
 * record ids must exist (the result step guarantees this, direct callers may
 * not); the save path comes from the dialog and is re-validated here so the
 * backend never sees blanks.
 */
export function buildSingleReportPayload(input: {
  baselineRecordId: string | null | undefined;
  postRecordId: string | null | undefined;
  path: string | null | undefined;
  format?: string | null;
}): SingleReportPayload {
  return {
    kind: 'single',
    path: requireTrimmed(input.path, '保存路径为空，请重新选择保存位置。'),
    format: resolveExportFormat(input.format),
    baselineRecordId: requireTrimmed(input.baselineRecordId, '缺少基线量表记录，无法导出报告。'),
    postRecordId: requireTrimmed(input.postRecordId, '缺少调控后量表记录，无法导出报告。'),
  };
}

/** Assembles the batch payload: every subject's latest run, CSV only. */
export function buildBatchReportPayload(input: {
  path: string | null | undefined;
}): BatchReportPayload {
  return {
    kind: 'batch',
    path: requireTrimmed(input.path, '保存路径为空，请重新选择保存位置。'),
  };
}

/**
 * Assembles the `export_effect_report` payload for the cross-condition
 * comparison export (R7, 大纲 6.3 步骤 5). The subject binding and target
 * emotion come from the wizard state - they identify the two legs the
 * backend re-pairs at export time.
 */
export function buildComparisonReportPayload(input: {
  subjectId: string | null | undefined;
  emotion: string | null | undefined;
  path: string | null | undefined;
  format?: string | null;
}): ComparisonReportPayload {
  return {
    kind: 'comparison',
    path: requireTrimmed(input.path, '保存路径为空，请重新选择保存位置。'),
    format: resolveExportFormat(input.format),
    subjectId: requireTrimmed(input.subjectId, '缺少被试 ID，无法导出跨条件对比报告。'),
    emotion: requireTrimmed(input.emotion, '缺少目标情绪，无法导出跨条件对比报告。'),
  };
}

/** Collapses a subject id into a file-name-safe fragment (CJK preserved). */
export function slugifySubjectForFile(subjectId: string | null | undefined): string {
  const cleaned = (subjectId ?? '')
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0);
      // Control characters and the letters Windows/macOS forbid in names.
      return code >= 0x20 && !FORBIDDEN_FILE_CHARS.has(char);
    })
    .join('')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40);

  return cleaned.length > 0 ? cleaned : 'subject';
}

function formatFileStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${
    pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * Save-dialog default name, e.g. `effect-report-subj-001-20260826-1530.json`.
 * Production omits `now`; tests pass a fixed date for deterministic names.
 */
export function suggestReportFileName(options: {
  kind: 'single' | 'batch' | 'comparison';
  format?: ExportReportFormat;
  subjectId?: string | null;
  now?: Date;
}): string {
  const stamp = formatFileStamp(options.now ?? new Date());

  if (options.kind === 'batch') {
    return `effect-summary-all-${stamp}.csv`;
  }

  const extension = resolveExportFormat(options.format);
  const subject = slugifySubjectForFile(options.subjectId);

  if (options.kind === 'comparison') {
    return `effect-comparison-${subject}-${stamp}.${extension}`;
  }

  return `effect-report-${subject}-${stamp}.${extension}`;
}
