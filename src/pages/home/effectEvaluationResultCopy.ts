import type { ConditionEffectComparisonView, RegulationEffectSummaryView } from '../../mentalScale/scaleRecordsApi';
import type { EffectEvaluationFlowState } from './effectEvaluationFlow';

/**
 * Result view-model copy for the effect-evaluation wizard (missing-record
 * guard, improvement formatting, verdict copy for the in-run summary and the
 * cross-condition comparison). Split out of the main pure module; type-only
 * import of the flow state keeps this a leaf at runtime.
 */

/** Chinese copy when the summary cannot be computed yet; null when ready. */
export function describeMissingMeasurements(state: EffectEvaluationFlowState): string | null {
  const missing: string[] = [];

  if (!state.baselineRecordId) {
    missing.push('基线');
  }

  if (!state.postRecordId) {
    missing.push('调控后');
  }

  if (missing.length === 0) {
    return null;
  }

  // phase='baseline' 的语义自 R6 起为“诱发后、条件前”（诱发步完成后、条件执行
  // 开始前测量）；文案保留“基线”叫法以与历史 phase 值一致。
  return `缺少${missing.join('与')}量表记录，无法计算改善率。请完整走完 诱发 → 诱发后量表 → 条件执行 → 条件后量表 流程。`;
}

/** Signed percent with one decimal: +40%, -12.5%, 0%. */
export function formatImprovementRate(rate: number): string {
  const percent = Math.round(rate * 1000) / 10;
  const sign = percent > 0 ? '+' : '';

  return `${sign}${percent}%`;
}

/**
 * Basis note under the result stats (F1 口径): a marker-based mean is the
 * honest default and needs no extra copy; a legacy pair computed over every
 * stored key must be flagged because it can include unmeasured placeholder
 * dimensions.
 */
export function describeMeasuredBasis(
  summary: Pick<RegulationEffectSummaryView, 'measuredOnly'>,
): string | null {
  return summary.measuredOnly
    ? null
    : '本次配对包含未标注实测维度的旧记录，按两侧全部已存维度计算，可能包含未实测的占位维度。';
}

export const EFFECT_DIMENSION_LABELS: Record<string, string> = {
  anxiety: '焦虑',
  energy: '精力',
  mood: '情绪',
  worry: '担忧',
};

export function labelForDimension(key: string): string {
  return EFFECT_DIMENSION_LABELS[key] ?? key;
}

export type EffectVerdictCopy = {
  severity: 'success' | 'warning';
  title: string;
  detail: string;
};

const THRESHOLD_PERCENT_LABEL = '10%';

export function buildEffectVerdictCopy(
  summary: Pick<RegulationEffectSummaryView, 'meanImprovementRate' | 'meetsThreshold'>,
): EffectVerdictCopy {
  if (summary.meanImprovementRate === null) {
    return {
      severity: 'warning',
      title: '无法判定调控效果',
      detail: '两次量表没有可对比的维度（维度缺失或基线为 0），请检查量表数据。',
    };
  }

  const meanText = formatImprovementRate(summary.meanImprovementRate);

  if (summary.meetsThreshold) {
    return {
      severity: 'success',
      title: '达到改善阈值',
      detail: `平均改善率 ${meanText}，不低于 ${THRESHOLD_PERCENT_LABEL} 的目标阈值，本次调控判定为有效。`,
    };
  }

  return {
    severity: 'warning',
    title: '未达到改善阈值',
    detail: `平均改善率 ${meanText}，低于 ${THRESHOLD_PERCENT_LABEL} 的目标阈值；负值表示情绪状态恶化。`,
  };
}

/**
 * Formula note rendered with the cross-condition card: the outline froze
 * this default 口径 at B-1; it may be swapped before testing, so the UI
 * states its source instead of presenting it as an immutable fact.
 */
export const CONDITION_COMPARISON_FORMULA_NOTE =
  '改善口径：(B_post - T_post) / B_post，按维度取两条件 post 分之差再除以基线条件 post 分（大纲 B-1 冻结项，默认口径，测试前可换）。';

export function buildConditionComparisonVerdictCopy(
  comparison: Pick<ConditionEffectComparisonView, 'meanImprovementRate' | 'meetsThreshold'>,
): EffectVerdictCopy {
  if (comparison.meanImprovementRate === null) {
    return {
      severity: 'warning',
      title: '无法判定跨条件改善',
      detail: '两条件没有可对比的维度（维度缺失或基线条件 post 为 0），请检查量表数据。',
    };
  }

  const meanText = formatImprovementRate(comparison.meanImprovementRate);

  if (comparison.meetsThreshold) {
    return {
      severity: 'success',
      title: '调控条件优于基线条件（达标）',
      detail: `跨条件平均改善率 ${meanText}，不低于 ${THRESHOLD_PERCENT_LABEL} 阈值，调控条件的改善高于自然恢复基线条件。`,
    };
  }

  return {
    severity: 'warning',
    title: '调控条件未优于基线条件',
    detail: `跨条件平均改善率 ${meanText}，低于 ${THRESHOLD_PERCENT_LABEL} 阈值；负值表示调控后的情绪状态不如自然恢复。`,
  };
}
