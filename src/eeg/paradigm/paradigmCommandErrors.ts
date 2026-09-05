import { describeEegError } from '../eegErrorMessages';
import type { TrialMarkKind } from './types';

/**
 * Banner copy for failed paradigm IPC commands. It carries business semantics
 * only — IPC command names stay in code. The detail half comes from the
 * central eegErrorMessages mapping: recognized backend errors add a concrete
 * cause, everything else degrades to a generic Chinese hint (original text
 * goes to console.error).
 */
export function toCommandErrorMessage(label: string, error: unknown, fallback: string) {
  return `${label}:${describeEegError(error, fallback)}`;
}

/** Business label per trial mark kind; the raw mark ids are protocol vocabulary. */
export const TRIAL_MARK_LABELS: Record<TrialMarkKind, string> = {
  pre_video_hint: '视频前提示标记发送失败',
  video: '视频播放标记发送失败',
  post_video_rest: '试后休息标记发送失败',
};
