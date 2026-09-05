import type { ParadigmVideoEntry } from '../../eeg/paradigm/types';

/**
 * Emotion-induction pool status for the effect-evaluation wizard's induction
 * step (R6, 大纲 6.2). Split out of the main pure module so the pool verdict
 * copy lives next to the pool types it describes.
 */

/**
 * video_paradigm library pool feeding the induction step for each target
 * emotion. R8: the library carries a first-class Fear pool (快乐素材已改造为
 * 恐惧占位), so every wizard emotion maps onto a scheduled class.
 */
export function paradigmPoolKeyForEmotion(
  emotion: 'anxiety' | 'depression' | 'fear',
): 'anxiety' | 'depression' | 'fear' {
  return emotion;
}

export type InductionPoolStatus =
  | { kind: 'ready'; entry: ParadigmVideoEntry }
  | { kind: 'blocked'; copy: string };

/**
 * Whether the induction step may play, derived from the target emotion and
 * the loaded pool (null = library missing/invalid). Every blocked case
 * carries an explicit operator-facing reason - the induction is a hard
 * precondition of the 大纲 flow, never silently skippable. Since R8 every
 * wizard emotion is a scheduled paradigm class, so the verdict depends only
 * on the pool; the emotion parameter stays on the contract for callers.
 *
 * `pickIndex` selects the pool entry (default: random) and is injectable so
 * tests stay deterministic.
 */
export function describeInductionPoolStatus(
  _emotion: 'anxiety' | 'depression' | 'fear',
  pool: readonly ParadigmVideoEntry[] | null,
  pickIndex: () => number = Math.random,
): InductionPoolStatus {
  // `== null` also catches runtime `undefined` (e.g. a stale backend without
  // the R8 fear pool key): a crash here blanked the whole wizard step.
  if (pool == null) {
    return {
      kind: 'blocked',
      copy: '尚未加载有效的范式视频素材库（video_paradigm），无法播放诱发素材。请先在 EEG 采集页选择并校验素材库，再回到本页开始诱发。',
    };
  }

  if (pool.length === 0) {
    return {
      kind: 'blocked',
      copy: '该情绪类别的诱发素材池为空，无法播放诱发素材。请先在 EEG 采集页补充对应类别的素材，本步骤为流程硬前置，不提供跳过。',
    };
  }

  // R8 hotfix: the default pickIndex is Math.random, whose value lies in [0, 1) -
  // a bare modulo yields a FRACTIONAL index, pool[index] evaluates to undefined,
  // and the induction step render crashes on entry.fileName (white screen).
  // Integer samplers keep the modulo path (negative-safe); fractional samplers
  // in [0, 1) are scaled by the pool length instead.
  const raw = pickIndex();
  const index = Number.isInteger(raw)
    ? ((raw % pool.length) + pool.length) % pool.length
    : Math.floor(raw * pool.length) % pool.length;
  const entry = pool[index];
  if (!entry) {
    return {
      kind: 'blocked',
      copy: '诱发素材选取异常，请重置流程后重试；若持续出现请检查素材库文件。',
    };
  }
  return { kind: 'ready', entry };
}
