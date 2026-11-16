import { invoke } from '@tauri-apps/api/core';

export type ScalePhase = 'pre_induction' | 'baseline' | 'post';

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
  return invoke<ScaleRecordView>('save_scale_record', {
    input: {
      ...input,
      subjectId: input.subjectId?.trim() || null,
      emotion: input.emotion ?? null,
      condition: input.condition ?? null,
      durationMinutes: input.durationMinutes ?? null,
      regulationSkipped: input.regulationSkipped ?? false,
    },
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
