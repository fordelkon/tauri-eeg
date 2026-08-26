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
 */
export function savePhaseScaleRecord(
  scale: MentalScaleDefinition,
  answers: MentalScaleAnswers,
  context: { userId: string | null; subjectId: string | null; phase: ScalePhase },
): Promise<ScaleRecordView> {
  return saveScaleRecord({
    userId: context.userId,
    subjectId: normalizeSubjectId(context.subjectId),
    scaleId: scale.path,
    phase: context.phase,
    dimensionScores: buildScaleDimensionScores(scale, answers),
    rawAnswers: answers,
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
