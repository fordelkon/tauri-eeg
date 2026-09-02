import { invoke } from '@tauri-apps/api/core';
import type { MentalScaleAnswers, MentalScaleDefinition } from './mentalScaleGate';
import { buildMentalScaleStatus, measuredDimensionKeys, type MentalScaleDimensionKey } from './mentalScaleStatus';
import { readStoredSubjectId } from '../storage/currentSubject';

/**
 * Persistence leg of the emotion-regulation evaluation loop: completed scale
 * submissions are mirrored into the backend `scale_records` table so baseline
 * and post measurements survive a restart (the in-memory status cache stays
 * the source for UI state).
 */

export type ScalePhase = 'baseline' | 'post';

export type ScaleRecordInput = {
  userId: string | null;
  subjectId: string | null;
  scaleId: string;
  phase: ScalePhase;
  dimensionScores: Record<MentalScaleDimensionKey, number>;
  rawAnswers: MentalScaleAnswers;
  /** Target emotion bound by the evaluation wizard; absent on gate saves. */
  emotion?: string | null;
  /**
   * Wizard condition of the run (R6, 大纲 6.2): `natural_recovery` (基线
   * 条件：诱发后不调控) or `regulation` (调控条件); absent on gate saves and
   * pre-R6 legacy rows (consumers treat legacy NULL as the regulation
   * condition of the old flow).
   */
  condition?: string | null;
  /** Configured regulation window in minutes; absent outside the wizard. */
  durationMinutes?: number | null;
  /** True when part of the regulation window was explicitly skipped. */
  regulationSkipped?: boolean;
  /**
   * Dimension keys actually measured by this submission (R4/F1): the effect
   * computation only compares keys marked on both sides so placeholder-filled
   * dimensions cannot dilute the mean.
   */
  measuredDimensions?: string[];
  /** EEG recording session linked to this run leg (the wizard's post leg). */
  eegSessionId?: string | null;
};

/** camelCase mirror of the backend ScaleRecord. */
export type ScaleRecordView = {
  id: string;
  userId: string;
  subjectId: string | null;
  scaleId: string;
  phase: ScalePhase;
  dimensionScores: Record<string, number>;
  rawAnswers: Record<string, unknown>;
  createdAt: string;
  emotion: string | null;
  /** Wizard condition of the run; null on pre-R6 legacy rows. */
  condition: string | null;
  durationMinutes: number | null;
  regulationSkipped: boolean;
  measuredDimensions: string[] | null;
  eegSessionId: string | null;
};

export type RegulationDimensionImprovementView = {
  dimension: string;
  baseline: number;
  post: number;
  improvementRate: number;
};

/** Backend summary plus the meets-threshold verdict (compute_regulation_effect). */
export type RegulationEffectSummaryView = {
  subjectId: string | null;
  dimensions: RegulationDimensionImprovementView[];
  meanImprovementRate: number | null;
  meetsThreshold: boolean;
  /** True when the mean covered only dimensions marked as measured on both sides (R4/F1). */
  measuredOnly: boolean;
};

/** camelCase mirror of the backend ConditionEffectComparison (R6, 大纲 6.2). */
export type ConditionDimensionComparisonView = {
  dimension: string;
  /** B_post: post score of the natural-recovery (baseline) condition run. */
  naturalRecoveryPost: number;
  /** T_post: post score of the regulation condition run. */
  regulationPost: number;
  improvementRate: number;
};

/** One condition's run feeding the comparison (camelCase mirror of the backend ConditionComparisonLeg). */
export type ConditionComparisonLegView = {
  /** Wizard condition of the leg's run; never null in a comparison pair
   * (legacy NULL runs are rejected on the backend, 大纲 6.2 诱发后口径). */
  condition: string;
  emotion: string | null;
  baselineRecordId: string;
  postRecordId: string;
  baselineCreatedAt: string;
  postCreatedAt: string;
  scaleId: string;
  durationMinutes: number | null;
  regulationSkipped: boolean;
  eegSessionId: string | null;
  /** False when this leg's in-run mean covered unmarked legacy records. */
  measuredOnly: boolean;
};

export type ConditionEffectComparisonView = {
  subjectId: string;
  emotion: string | null;
  /** Trace of the natural-recovery run feeding B_post. */
  naturalRecoveryLeg: ConditionComparisonLegView;
  /** Trace of the regulation run feeding T_post. */
  regulationLeg: ConditionComparisonLegView;
  dimensions: ConditionDimensionComparisonView[];
  meanImprovementRate: number | null;
  meetsThreshold: boolean;
  /** False when either side is an unmarked legacy run (all stored keys). */
  measuredOnly: boolean;
};

function normalizeSubjectId(subjectId: string | null | undefined): string | null {
  const trimmed = subjectId?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export function saveScaleRecord(input: ScaleRecordInput): Promise<ScaleRecordView> {
  return invoke<ScaleRecordView>('save_scale_record', { input });
}

/** Local re-computation of the per-dimension scores stored with a record. */
export function buildScaleDimensionScores(
  scale: MentalScaleDefinition,
  answers: MentalScaleAnswers,
): Record<MentalScaleDimensionKey, number> {
  const status = buildMentalScaleStatus(scale, answers);
  return Object.fromEntries(
    status.dimensions.map((dimension) => [dimension.key, dimension.value]),
  ) as Record<MentalScaleDimensionKey, number>;
}

type PersistSubmissionOptions = {
  /**
   * Explicit subject binding; the evaluation flow passes its configured
   * subject here. When omitted the shared subject memory is consulted so
   * gate submissions inherit whatever subject the operator last set.
   */
  subjectId?: string | null;
  /** Defaults to `baseline` (the gate measures right before a regulation). */
  phase?: ScalePhase;
};

/**
 * Fire-and-forget persistence of one completed gate submission. The gate's
 * memory-cache behavior is untouched; a persistence failure must never block
 * navigation, so it only lands in the console.
 */
export function persistMentalScaleSubmission(
  scale: MentalScaleDefinition,
  answers: MentalScaleAnswers,
  userId: string | null,
  options: PersistSubmissionOptions = {},
): void {
  void saveScaleRecord({
    userId,
    // Explicit binding wins; otherwise fall back to the shared subject memory
    // (still null when no subject was ever configured).
    subjectId: options.subjectId !== undefined
      ? normalizeSubjectId(options.subjectId)
      : normalizeSubjectId(readStoredSubjectId()),
    scaleId: scale.path,
    phase: options.phase ?? 'baseline',
    dimensionScores: buildScaleDimensionScores(scale, answers),
    rawAnswers: answers,
    // Gate submissions carry the same measured markers so a gate baseline
    // paired with a wizard post keeps the marker-based comparison (R4/F1).
    measuredDimensions: measuredDimensionKeys(scale, answers),
  }).catch((error: unknown) => {
    console.warn('[mentalScale] 量表记录落库失败:', error);
  });
}

/**
 * Awaited save used by the effect-evaluation wizard: the caller needs the
 * persisted record id to pair baseline/post and compute the improvement.
 * The wizard's target emotion, run condition, planned duration, and (on the
 * post leg) the skip marker plus the associated EEG session id ride along for
 * the history view, cross-condition comparison, and report exports.
 */
export function savePhaseScaleRecord(
  scale: MentalScaleDefinition,
  answers: MentalScaleAnswers,
  context: {
    userId: string | null;
    subjectId: string | null;
    phase: ScalePhase;
    emotion?: string | null;
    condition?: string | null;
    durationMinutes?: number | null;
    regulationSkipped?: boolean;
    eegSessionId?: string | null;
  },
): Promise<ScaleRecordView> {
  return saveScaleRecord({
    userId: context.userId,
    subjectId: normalizeSubjectId(context.subjectId),
    scaleId: scale.path,
    phase: context.phase,
    dimensionScores: buildScaleDimensionScores(scale, answers),
    rawAnswers: answers,
    emotion: context.emotion ?? null,
    condition: context.condition ?? null,
    durationMinutes: context.durationMinutes ?? null,
    regulationSkipped: context.regulationSkipped ?? false,
    measuredDimensions: measuredDimensionKeys(scale, answers),
    eegSessionId: context.eegSessionId ?? null,
  });
}

/**
 * Computes the regulation effect for one saved baseline/post pair. Phase and
 * cross-subject validation happen on the backend.
 */
export function computeRegulationEffect(
  baselineRecordId: string,
  postRecordId: string,
): Promise<RegulationEffectSummaryView> {
  return invoke<RegulationEffectSummaryView>('compute_regulation_effect', {
    input: {
      baselineRecordId,
      postRecordId,
    },
  });
}

/**
 * Cross-condition comparison (R6, 大纲 6.2, 公式来源：大纲 B-1 冻结项，默认口
 * 径，测试前可换): pairs the latest complete run of each condition for one
 * subject+emotion and computes the regulation condition's improvement
 * relative to the natural-recovery baseline condition, per dimension
 * `(B_post - T_post) / B_post`. Errors when either condition lacks a
 * complete run.
 */
export function computeConditionEffect(
  subjectId: string,
  emotion: string,
): Promise<ConditionEffectComparisonView> {
  return invoke<ConditionEffectComparisonView>('compute_condition_effect', {
    input: { subjectId, emotion },
  });
}

/** One completed evaluation run in the history review (list_effect_history). */
export type EffectHistoryEntryView = {
  subjectId: string;
  baselineRecordId: string;
  postRecordId: string;
  baselineCreatedAt: string;
  postCreatedAt: string;
  scaleId: string;
  emotion: string | null;
  /** Wizard condition of the run; null on pre-R6 legacy rows (= regulation). */
  condition: string | null;
  durationMinutes: number | null;
  regulationSkipped: boolean;
  /** EEG recording session of the run (post leg first, baseline fallback). */
  eegSessionId: string | null;
  /** False when the mean was computed over unmarked legacy records. */
  measuredOnly: boolean;
  meanImprovementRate: number | null;
  meetsThreshold: boolean;
  dimensions: RegulationDimensionImprovementView[];
};

/** camelCase mirror of the backend ExportEffectReportInput. */
export type ExportEffectReportInput =
  | {
    kind: 'single';
    path: string;
    format?: 'json' | 'csv';
    baselineRecordId: string;
    postRecordId: string;
  }
  | { kind: 'batch'; path: string }
  | {
    /** R7, 大纲 6.3 步骤 5: cross-condition comparison export with both
     * legs' trace, the per-dimension inputs, and the frozen formula note. */
    kind: 'comparison';
    path: string;
    format?: 'json' | 'csv';
    subjectId: string;
    emotion: string;
  };

export type ExportEffectReportResultView = {
  path: string;
  bytes: number;
};

/**
 * Loads every completed baseline/post run, paired chronologically per
 * subject on the backend (the history review tab's data source).
 */
export function listEffectHistory(): Promise<EffectHistoryEntryView[]> {
  return invoke<EffectHistoryEntryView[]>('list_effect_history');
}

export function deleteScaleRecord(id: string): Promise<ScaleRecordView> {
  return invoke<ScaleRecordView>('delete_scale_record', { input: { id } });
}

/**
 * Writes one run's JSON/CSV report, the all-subjects batch CSV, or the
 * cross-condition comparison document of one subject+emotion to a
 * user-chosen path (picked through the save dialog before this call).
 */
export function exportEffectReport(
  input: ExportEffectReportInput,
): Promise<ExportEffectReportResultView> {
  return invoke<ExportEffectReportResultView>('export_effect_report', { input });
}

// PROBE-1788340860040
