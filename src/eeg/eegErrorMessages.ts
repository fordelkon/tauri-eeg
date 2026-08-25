/**
 * Central mapping from raw backend / internal error text to operator-facing
 * Chinese copy. Recognized strings get a concrete cause plus a recovery
 * action; anything else degrades to a generic prompt while the original text
 * goes to console.error so it stays available for diagnosis.
 */

type EegErrorCopy = {
  /** What went wrong, phrased to also read naturally after a "xx失败:" prefix. */
  message: string;
  /** What the operator can do about it; appended right after `message`. */
  action?: string;
};

const GENERIC_EEG_ERROR_MESSAGE = '操作未能完成,请重试。若持续失败,请重启应用。';

const KNOWN_EEG_ERRORS: Record<string, EegErrorCopy> = {
  // EegSessionContext device lifecycle.
  'Failed to subscribe to EEG status events.': {
    message: '设备状态监听初始化失败',
    action: ',设备状态提示可能不可用,请重启应用。',
  },
  'Failed to start EEG stream.': {
    message: '启动脑电设备失败',
    action: ',请检查设备电源与 USB 连接后重试。',
  },
  'Timed out waiting for the EEG device to connect. Check the device and try again.': {
    message: '连接超时',
    action: ',请检查设备电源与 USB 连接后重试。',
  },
  'EEG device disconnected.': {
    message: '脑电设备连接已断开',
    action: ',请检查设备连接后重新启动采集。',
  },
  'Failed to stop EEG stream.': {
    message: '停止脑电设备失败',
    action: ',请稍后重试。',
  },
  // EegSessionContext recording lifecycle.
  'Sign in before recording EEG.': {
    message: '尚未登录',
    action: ',请先登录后再记录脑电数据。',
  },
  'Failed to start EEG recording.': {
    message: '开始记录失败',
    action: ',请确认脑电设备已连接后重试。',
  },
  'Failed to stop EEG recording.': {
    message: '结束记录失败',
    action: ',本次数据可能未完整保存,请重试。',
  },
  // ParadigmRunner trial lifecycle fallbacks (backend rejections arrive as
  // plain English strings and only hit these when they carry no detail).
  'Trial could not be started.': {
    message: '后端未确认试次开始',
    action: ',请稍候后重试。',
  },
  'Trial could not be ended.': {
    message: '后端未确认试次结束',
    action: ',请稍候后重试。',
  },
  'Trial mark failed.': {
    message: '标记未送达后端',
    action: ',不影响后续采集。',
  },
  'Trial could not be finalized.': {
    message: '后端未确认写入',
    action: ',该试次可能未被记录,请重试。',
  },
  'Summary could not be loaded.': {
    message: '后端未返回统计数据',
    action: ',可返回设置后重新进入查看。',
  },
};

function eegErrorDetail(error: unknown, fallback?: string): string | null {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback ?? null;
}

/**
 * Translate a raw error into user-facing copy. `fallback` covers non-text
 * errors (Tauri rejections are strings, but thrown objects may not be) and is
 * itself looked up so our own English literals stay out of the UI too.
 */
export function describeEegError(error: unknown, fallback?: string): string {
  const detail = eegErrorDetail(error, fallback);
  const known = detail !== null ? KNOWN_EEG_ERRORS[detail] : undefined;

  if (known) {
    return `${known.message}${known.action ?? ''}`;
  }

  // Unrecognized text never reaches the UI; keep the original in the console
  // so operators can still report it verbatim.
  if (detail === null) {
    console.error('[eeg] 收到非文本错误:', error);
  } else {
    console.error('[eeg] 未识别的错误信息:', detail);
  }

  return GENERIC_EEG_ERROR_MESSAGE;
}
