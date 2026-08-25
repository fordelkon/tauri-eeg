import { describe, expect, it, vi } from 'vitest';
import { describeFriendlyError } from './friendlyError';

const GENERIC_MESSAGE = '操作未能完成,请稍后重试。若持续失败,请重启应用。';

function spyOnConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('describeFriendlyError', () => {
  it('degrades raw backend text to the generic prompt and logs the original', () => {
    const errorSpy = spyOnConsoleError();

    try {
      expect(describeFriendlyError('Failed to reach music generation service.')).toBe(GENERIC_MESSAGE);
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0]?.join(' ')).toContain('Failed to reach music generation service.');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('looks Error objects up by their message', () => {
    const errorSpy = spyOnConsoleError();

    try {
      expect(describeFriendlyError(new Error('Database is unavailable.'))).toBe(GENERIC_MESSAGE);
      expect(errorSpy.mock.calls[0]?.join(' ')).toContain('Database is unavailable.');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('prefixes the copy with the failed action when a context is given', () => {
    const errorSpy = spyOnConsoleError();

    try {
      expect(describeFriendlyError('Prompt is required.', '生成 WAV')).toBe('生成 WAV失败,请稍后重试。');
      expect(errorSpy.mock.calls[0]?.[0]).toBe('[ui] 生成 WAV失败:');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs non-text errors verbatim and still returns the generic prompt', () => {
    const errorSpy = spyOnConsoleError();
    const raw = { code: 42 };

    try {
      expect(describeFriendlyError(raw)).toBe(GENERIC_MESSAGE);
      expect(errorSpy).toHaveBeenCalledWith('[ui] 操作失败,收到非文本错误:', raw);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('treats an empty Error message as non-text', () => {
    const errorSpy = spyOnConsoleError();

    try {
      expect(describeFriendlyError(new Error(''))).toBe(GENERIC_MESSAGE);
      expect(errorSpy).toHaveBeenCalledWith('[ui] 操作失败,收到非文本错误:', new Error(''));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('maps known storage-path validation errors to concrete copy', () => {
    const errorSpy = spyOnConsoleError();

    try {
      expect(describeFriendlyError('Storage path must be absolute.', '保存存储路径')).toBe(
        '存储路径必须是绝对路径,例如 D:\\ExperimentData。',
      );
      expect(errorSpy.mock.calls[0]?.join(' ')).toContain('Storage path must be absolute.');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('passes through backend text that is already localized Chinese', () => {
    const errorSpy = spyOnConsoleError();
    const localized = '视频库文件夹中缺少 JSON 索引文件。';

    try {
      expect(describeFriendlyError(localized, '加载视频库')).toBe(localized);
      expect(errorSpy.mock.calls[0]?.join(' ')).toContain(localized);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
