import { invoke } from '@tauri-apps/api/core';
import type { MentalScaleAnswers, MentalScaleDefinition } from './mentalScaleGate';
import { buildMentalScaleStatus, type MentalScaleDimensionKey } from './mentalScaleStatus';

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

export function saveScaleRecord(input: ScaleRecordInput): Promise<void> {
  return invoke<void>('save_scale_record', { input });
}

/**
 * Fire-and-forget persistence of one completed gate submission. The gate's
 * memory-cache behavior is untouched; a persistence failure must never block
 * navigation, so it only lands in the console.
 *
 * The gate measures the state right before a regulation activity starts, so
 * submissions persist as the `baseline` phase of the loop. Subject binding
 * arrives with the paradigm-session integration — until then records carry
 * no subject id.
 */
export function persistMentalScaleSubmission(
  scale: MentalScaleDefinition,
  answers: MentalScaleAnswers,
  userId: string | null,
): void {
  const status = buildMentalScaleStatus(scale, answers);
  const dimensionScores = Object.fromEntries(
    status.dimensions.map((dimension) => [dimension.key, dimension.value]),
  ) as Record<MentalScaleDimensionKey, number>;

  void saveScaleRecord({
    userId,
    subjectId: null,
    scaleId: scale.path,
    phase: 'baseline',
    dimensionScores,
    rawAnswers: answers,
  }).catch((error: unknown) => {
    console.warn('[mentalScale] 量表记录落库失败:', error);
  });
}
