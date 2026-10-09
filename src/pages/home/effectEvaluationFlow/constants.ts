import type { MentalScalePath } from '../../../mentalScale/mentalScaleGate';

/** Wizard option constants and step definitions for the effect evaluation. */

export type EffectTargetEmotion = 'anxiety' | 'depression' | 'fear';

export type EffectRegulationMethod = 'music' | 'video';

/**
 * Wizard condition of a run (R6, 大纲 6.2): `natural_recovery` is the 基线
 * condition (诱发后不调控、自然恢复), `regulation` is the 调控 condition. Each
 * wizard session runs exactly one condition; the result step's
 * cross-condition comparison pairs one complete run of each condition.
 */
export type EffectCondition = 'natural_recovery' | 'regulation';

export const EFFECT_EMOTION_OPTIONS = [
  { value: 'anxiety', label: '焦虑' },
  { value: 'depression', label: '抑郁' },
  { value: 'fear', label: '恐惧' },
] as const;

export const EFFECT_CONDITION_OPTIONS = [
  { value: 'natural_recovery', label: '基线条件（自然恢复）' },
  { value: 'regulation', label: '调控条件' },
] as const satisfies ReadonlyArray<{
  value: EffectCondition;
  label: string;
}>;

export const EFFECT_METHOD_OPTIONS = [
  { value: 'music', label: '音乐调控', path: '/music-regulation' },
  { value: 'video', label: '视频调控', path: '/video-regulation' },
] as const satisfies ReadonlyArray<{
  value: EffectRegulationMethod;
  label: string;
  path: MentalScalePath;
}>;

/**
 * Chinese label for a run's condition; `null` marks pre-R6 legacy rows of
 * the old regulation-only flow, which consumers treat as the regulation
 * condition and label explicitly so exports/history stay honest.
 */
export function labelForCondition(condition: string | null): string {
  if (condition === null) {
    return '调控条件（legacy 旧流程）';
  }

  return EFFECT_CONDITION_OPTIONS.find((option) => option.value === condition)?.label
    ?? condition;
}

/** Wizard steps, in execution order. */
export const EFFECT_FLOW_STEPS = [
  '选择被试',
  '情绪诱发',
  '诱发后量表',
  '条件执行',
  '条件后量表',
  '结果评价',
] as const;

export const EFFECT_FLOW_STEP_COUNT = EFFECT_FLOW_STEPS.length;

export type EffectFlowStep = 0 | 1 | 2 | 3 | 4 | 5;

export const DEFAULT_REGULATION_MINUTES = 5;
export const MIN_REGULATION_MINUTES = 1;
export const MAX_REGULATION_MINUTES = 30;
