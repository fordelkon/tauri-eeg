import { invoke } from '@tauri-apps/api/core';
import type { MentalScaleAnswers, MentalScaleDefinition } from './mentalScaleGate';
import {
  buildMentalScaleStatus,
  measuredDimensionKeys,
  type MentalScaleDimensionKey,
} from './mentalScaleStatus';
import { readStoredSubjectId } from '../storage/currentSubject';

export type ScalePhase = 'pre_induction' | 'baseline' | 'post';

export type ScaleRecordInput = {
  experimentRunId?: string;
  userId: string | null;
  subjectId: string | null;
  scaleId: string;
  phase: ScalePhase;
  /** Scores for the dimensions reported by this instrument. */
  dimensionScores: Record<string, number>;
  /** Item responses and the measurement timeframe. */
  rawAnswers: Record<string, unknown>;
  /** Target emotion bound by the evaluation wizard; absent on gate saves. */
  emotion?: string | null;
  condition?: string | null;
  /** Configured regulation window in minutes; absent outside the wizard. */
  durationMinutes?: number | null;
  /** True when part of the regulation window was explicitly skipped. */
  regulationSkipped?: boolean;
  measuredDimensions?: string[];
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
  condition: string | null;
  durationMinutes: number | null;
  regulationSkipped: boolean;
  measuredDimensions: string[] | null;
};

export type EmotionChange = {
  dimension: 'anxiety' | 'sadness' | 'fear';
  preInduction: number;
  baseline: number;
  post: number;
  inductionChange: number;
  conditionChange: number;
};

export type RegulationEffectSummaryView = {
  subjectId: string | null;
  emotionChanges: EmotionChange[];
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
 *
 * The instrument ID and current-state timeframe distinguish new entries from historical screening.
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
    subjectId:
      options.subjectId !== undefined
        ? normalizeSubjectId(options.subjectId)
        : normalizeSubjectId(readStoredSubjectId()),
    scaleId: scale.scaleId,
    phase: options.phase ?? 'baseline',
    dimensionScores: buildScaleDimensionScores(scale, answers),
    rawAnswers: { ...answers, timeframe: 'now' },
    measuredDimensions: measuredDimensionKeys(scale, answers),
  }).catch((error: unknown) => {
    console.warn('[mentalScale] 量表记录落库失败:', error);
  });
}

export type PhaseInstrumentRecordInput = {
  experimentRunId: string;
  userId: string | null;
  subjectId: string | null;
  scaleId: string;
  phase: ScalePhase;
  dimensionScores: Record<string, number>;
  /** Instrument raw-answers payload, stored verbatim as JSON. */
  rawAnswers: Record<string, unknown>;
  /** Subscales measured by this submission. */
  measuredDimensions: string[];
  emotion?: string | null;
  condition?: string | null;
  durationMinutes?: number | null;
  regulationSkipped?: boolean;
};

/** Saves the DEQ answers and their run association in one operation. */
export function savePhaseInstrumentRecord(
  input: PhaseInstrumentRecordInput,
): Promise<ScaleRecordView> {
  return saveScaleRecord({
    experimentRunId: input.experimentRunId,
    userId: input.userId,
    subjectId: normalizeSubjectId(input.subjectId),
    scaleId: input.scaleId,
    phase: input.phase,
    dimensionScores: input.dimensionScores,
    rawAnswers: input.rawAnswers,
    emotion: input.emotion ?? null,
    condition: input.condition ?? null,
    durationMinutes: input.durationMinutes ?? null,
    regulationSkipped: input.regulationSkipped ?? false,
    measuredDimensions: input.measuredDimensions,
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
  emotionChanges: EmotionChange[];
  preInductionRecordId: string;
  experimentRunId: string;
  subjectId: string;
  baselineRecordId: string;
  postRecordId: string;
  baselineCreatedAt: string;
  postCreatedAt: string;
  scaleId: string;
  emotion: string | null;
  condition: string | null;
  durationMinutes: number | null;
  regulationSkipped: boolean;
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

export function listEffectHistory(): Promise<EffectHistoryEntryView[]> {
  return invoke<EffectHistoryEntryView[]>('list_effect_history');
}

export function deleteScaleRecord(id: string): Promise<ScaleRecordView> {
  return invoke<ScaleRecordView>('delete_scale_record', { input: { id } });
}

export function exportEffectReport(
  input: ExportEffectReportInput,
): Promise<ExportEffectReportResultView> {
  return invoke<ExportEffectReportResultView>('export_effect_report', { input });
}
