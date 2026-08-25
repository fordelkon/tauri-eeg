/**
 * Generic degradation for non-EEG backend failures (music, video, storage):
 * common validation mistakes get concrete Chinese copy, backend text that is
 * already localized passes through untouched, and everything else degrades to
 * a neutral generic prompt while the original goes to console.error so it
 * stays available for diagnosis. Modeled on src/eeg/eegErrorMessages.ts.
 */

const GENERIC_ERROR_MESSAGE = '操作未能完成,请稍后重试。若持续失败,请重启应用。';

// Validation failures operators can actually fix themselves, keyed by the raw
// backend string (storage_paths.rs validate_custom_root).
const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  'Storage path is required.': '存储路径不能为空。',
  'Storage path must be absolute.': '存储路径必须是绝对路径,例如 D:\\ExperimentData。',
  'Storage path cannot contain parent directory segments.': '存储路径不能包含 ".."(上级目录)。',
};

function friendlyErrorDetail(error: unknown): string | null {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return null;
}

/**
 * Degrade a raw failure into user-facing copy. Known validation errors and
 * backend strings that are already Chinese (video_library.rs localizes in
 * Rust) surface as-is; otherwise `context` names the failed action ("生成
 * WAV"), yielding "<context>失败,请稍后重试。", or a fully generic line is
 * returned. The original text always lands in the console first.
 */
export function describeFriendlyError(error: unknown, context?: string): string {
  const detail = friendlyErrorDetail(error);

  if (detail === null) {
    console.error('[ui] 操作失败,收到非文本错误:', error);
    return GENERIC_ERROR_MESSAGE;
  }

  console.error(`[ui] ${context ?? '操作'}失败:`, detail);

  const known = KNOWN_ERROR_MESSAGES[detail];
  if (known) {
    return known;
  }

  // Some backend modules return finished operator-facing Chinese; let those
  // through rather than flattening them to the generic line.
  if (/[\u4e00-\u9fff]/.test(detail)) {
    return detail;
  }

  return context ? `${context}失败,请稍后重试。` : GENERIC_ERROR_MESSAGE;
}
