import { describe, expect, it, vi } from 'vitest';
import { describeEegError } from './eegErrorMessages';

const GENERIC_MESSAGE = '操作未能完成,请重试。若持续失败,请重启应用。';

function spyOnConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('describeEegError', () => {
  it('translates known raw strings into Chinese cause plus action', () => {
    expect(describeEegError(
      'Timed out waiting for the EEG device to connect. Check the device and try again.',
    )).toBe('连接超时,请检查设备电源与 USB 连接后重试。');
    expect(describeEegError('Failed to start EEG stream.')).toBe(
      '启动脑电设备失败,请检查设备电源与 USB 连接后重试。',
    );
  });

  it('looks Error objects up by their message', () => {
    expect(describeEegError(new Error('Sign in before recording EEG.'))).toBe(
      '尚未登录,请先登录后再记录脑电数据。',
    );
  });

  it('also maps the fallback when the error carries no usable text', () => {
    expect(describeEegError(null, 'EEG device disconnected.')).toBe(
      '脑电设备连接已断开,请检查设备连接后重新启动采集。',
    );
    expect(describeEegError(new Error(''), 'Failed to stop EEG stream.')).toBe(
      '停止脑电设备失败,请稍后重试。',
    );
  });

  it('keeps paradigm trial fallbacks composible behind a 失败 prefix', () => {
    expect(describeEegError('Trial could not be started.', 'Trial could not be started.')).toBe(
      '后端未确认试次开始,请稍候后重试。',
    );
    expect(`开始试次失败:${describeEegError('Trial mark failed.')}`).toBe(
      '开始试次失败:标记未送达后端,不影响后续采集。',
    );
  });

  it('does not log recognized errors', () => {
    const errorSpy = spyOnConsoleError();

    try {
      describeEegError('Failed to start EEG recording.');

      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('degrades unrecognized backend text to the generic prompt and logs the original', () => {
    const errorSpy = spyOnConsoleError();

    try {
      expect(describeEegError('some future backend rejection')).toBe(GENERIC_MESSAGE);
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0]?.join(' ')).toContain('some future backend rejection');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs the raw object when neither error nor fallback yields text', () => {
    const errorSpy = spyOnConsoleError();
    const raw = { code: 42 };

    try {
      expect(describeEegError(raw)).toBe(GENERIC_MESSAGE);
      expect(errorSpy).toHaveBeenCalledWith('[eeg] 收到非文本错误:', raw);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
