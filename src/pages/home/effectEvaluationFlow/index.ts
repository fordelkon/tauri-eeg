/**
 * Pure state machine + view-model helpers for the effect-evaluation wizard
 * (设置 → 情绪诱发 → 诱发后量表 → 条件执行 → 条件后量表 → 结果评价).
 * Kept free of React, Tauri, and DOM access so the step gating, countdown
 * math, and result copy are unit-testable in the node vitest environment.
 *
 * Split by responsibility: `constants` (options + steps), `state`
 * (serializable wizard state + strict parser), `storage` (sessionStorage
 * persistence + window-open guard), `regulation` (window timing + countdown
 * + regulation-page context).
 *
 * Two leaf modules split out of this machine earlier (re-exported below so
 * every consumer keeps importing from here): `effectInductionPool.ts` (the
 * emotion-induction pool verdict) and `effectEvaluationResultCopy.ts` (the
 * result view-model copy).
 */

// Re-exports: the emotion-induction pool verdict (R6).
export {
  describeInductionPoolStatus,
  paradigmPoolKeyForEmotion,
} from '../effectInductionPool';
export type { InductionPoolStatus } from '../effectInductionPool';

// Re-exports: the result view-model copy (verdicts, basis notes, formulas).
export {
  buildConditionComparisonVerdictCopy,
  buildEffectVerdictCopy,
  CONDITION_COMPARISON_FORMULA_NOTE,
  describeMeasuredBasis,
  describeMissingMeasurements,
  EFFECT_DIMENSION_LABELS,
  formatImprovementRate,
  labelForDimension,
} from '../effectEvaluationResultCopy';
export type { EffectVerdictCopy } from '../effectEvaluationResultCopy';

export * from './constants';
export * from './regulation';
export * from './state';
export * from './storage';
