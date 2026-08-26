import { invoke } from '@tauri-apps/api/core';
import type { MentalScaleAnswers, MentalScaleDefinition } from './mentalScaleGate';
import { buildMentalScaleStatus, type MentalScaleDimensionKey } from './mentalScaleStatus';
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
  /** Configured regulation window in minutes; absent outside the wizard. */
  durationMinutes?: number | null;
  /** True when part of the regulation window was explicitly skipped. */
  regulationSkipped?: boolean;
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
  durationMinutes: number | null;
  regulationSkipped: boolean;
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
  }).catch((error: unknown) => {
    console.warn('[mentalScale] 量表记录落库失败:', error);
  });
}

/**
 * Awaited save used by the effect-evaluation wizard: the caller needs the
 * persisted record id to pair baseline/post and compute the improvement.
 * The wizard's target emotion, planned duration, and (on the post leg) the
 * skip marker ride along for the history view and report exports.
 */
export function savePhaseScaleRecord(
  scale: MentalScaleDefinition,
  answers: MentalScaleAnswers,
  context: {
    userId: string | null;
    subjectId: string | null;
    phase: ScalePhase;
    emotion?: string | null;
    durationMinutes?: number | null;
    regulationSkipped?: boolean;
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
    durationMinutes: context.durationMinutes ?? null,
    regulationSkipped: context.regulationSkipped ?? false,
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

/** One completed evaluation run in the history review (list_effect_history). */
export type EffectHistoryEntryView = {
  subjectId: string;
  baselineRecordId: string;
  postRecordId: string;
  baselineCreatedAt: string;
  postCreatedAt: string;
  scaleId: string;
  emotion: string | null;
  durationMinutes: number | null;
  regulationSkipped: boolean;
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
  | { kind: 'batch'; path: string };

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

/**
 * Writes one run's JSON/CSV report or the all-subjects batch CSV to a
 * user-chosen path (picked through the save dialog before this call).
 */
export function exportEffectReport(
  input: ExportEffectReportInput,
): Promise<ExportEffectReportResultView> {
  return invoke<ExportEffectReportResultView>('export_effect_report', { input });
}
