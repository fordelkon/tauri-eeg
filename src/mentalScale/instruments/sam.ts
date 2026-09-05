/**
 * SAM (Self-Assessment Manikin, numeric variant) — the per-trial
 * manipulation-check scale for the emotion-induction leg. Source: Bradley MM,
 * Lang PJ (1994). Measuring emotion: The Self-Assessment Manikin and the
 * semantic differential. J Behav Ther Exp Psychiatry 25(1):49-59 (NIMH CSEA,
 * free for research use).
 *
 * Spec source: docs/scale-instruments.md §2.4 — valence/arousal/dominance,
 * one rating each on 1-9 (1 = unpleasant/calm/controlled, 9 = pleasant/
 * excited/dominant). This module implements the numeric 1-9 variant with
 * Chinese bipolar end labels; no graphic manikin is rendered (the wizard's
 * battery dialog reuses the shared anchor-row visual language).
 *
 * Storage (doc §3.3): SAM does NOT get its own scale_records row — its
 * answers ride the baseline battery record as raw_answers.sam, avoiding the
 * backend validate_phase (baseline|post only) and build_effect_history
 * (subject,condition) pairing limits.
 */

export const samScaleId = 'sam_vad_v1';

export const SAM_MIN_VALUE = 1;
export const SAM_MAX_VALUE = 9;

export type SamDimensionKey = 'valence' | 'arousal' | 'dominance';

/** The three VAD dimensions in presentation order. */
export const samDimensionKeys: readonly SamDimensionKey[] = [
  'valence',
  'arousal',
  'dominance',
];

export type SamDimension = {
  /** Raw answer key (doc §3.3 stores answers as {valence, arousal, dominance}). */
  id: SamDimensionKey;
  /** English dimension name (doc §2.4). */
  textEn: string;
  /** Chinese dimension name shown in the UI. */
  textZh: string;
  /** Bipolar anchor label for the lowest value (1). */
  lowLabel: string;
  /** Bipolar anchor label for the highest value (9). */
  highLabel: string;
};

/**
 * The three VAD dimensions with their bipolar poles: valence 1=非常不愉快 ↔
 * 9=非常愉快, arousal 1=完全平静 ↔ 9=完全激动, dominance 1=完全受控 ↔
 * 9=完全主导.
 */
export const samDimensions: readonly SamDimension[] = [
  { id: 'valence', textEn: 'Valence', textZh: '效价', lowLabel: '非常不愉快', highLabel: '非常愉快' },
  { id: 'arousal', textEn: 'Arousal', textZh: '唤醒', lowLabel: '完全平静', highLabel: '完全激动' },
  { id: 'dominance', textEn: 'Dominance', textZh: '支配', lowLabel: '完全受控', highLabel: '完全主导' },
];

/** Section instruction shown above the three bipolar rows in the battery dialog. */
export const SAM_INSTRUCTION =
  '刚看完的诱发画面带给你的当下感受如何？请对以下三个维度分别在 1-9 之间选择最符合的一项。';

export type SamScore = Record<SamDimensionKey, number>;

/**
 * Pure SAM scorer: raw 1-9 ratings pass through verbatim (descriptive
 * manipulation-check data — never polarity-normalized into the improvement
 * engine, doc §1). Throws on a missing or out-of-range answer — callers gate
 * submission on completeness first.
 */
export function scoreSam(answers: Record<string, number>): SamScore {
  const score = {} as SamScore;

  for (const key of samDimensionKeys) {
    const value = answers[key];
    if (
      typeof value !== 'number'
      || !Number.isInteger(value)
      || value < SAM_MIN_VALUE
      || value > SAM_MAX_VALUE
    ) {
      throw new Error(`Invalid or missing SAM answer for ${key}.`);
    }
    score[key] = value;
  }

  return score;
}
