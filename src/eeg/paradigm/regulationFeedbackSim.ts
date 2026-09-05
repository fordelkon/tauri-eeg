/**
 * Simulated decoder for the regulation_feedback rehearsal (试运行, no device).
 *
 * Stands in for the future subject-specific EEG emotion decoder: it produces
 * a plausible "target-state proximity" score trajectory over the regulation
 * window — a random walk drifting upward from a class-dependent baseline — so
 * the intermittent feedback stage behaves exactly like the closed loop will.
 * The statistics collected per trial reuse the R = p(regulation) − p(baseline)
 * definition from the protocol so the summary screen mirrors the real
 * experiment's learning index.
 *
 * NOTE: this module is intentionally frontend-only and never touches the
 * backend contract; when the real decoder lands, the runner swaps this module
 * for decoder values behind the same RegulationFeedbackSample shape.
 */
import type { ParadigmEmotion } from './types';
import { REGULATION_DECODE_STEPS } from './paradigmTimeline';

/** One simulated regulation trial's decoder output. */
export type RegulationFeedbackSample = {
  /** Target-state proximity during the induction video (the feedback bar's reference). */
  baselineScore: number;
  /** Mean target proximity over the second half of the regulation window. */
  regulationScore: number;
  /** R = regulationScore − baselineScore (the trial's regulation success). */
  deltaScore: number;
  /** Per-decode-window proximity estimates across the regulation window. */
  trajectory: number[];
};

/** Per-trial statistics kept for the end-of-session regulation summary. */
export type RegulationFeedbackStat = {
  emotion: ParadigmEmotion;
  baselineScore: number;
  regulationScore: number;
  deltaScore: number;
};

export type RegulationFeedbackSummary = {
  totalTrials: number;
  baselineMean: number;
  regulationMean: number;
  /** Session-level learning index L1 (mean R across regulation trials). */
  deltaMean: number;
  improvedTrials: number;
};

const SCORE_MIN = 0.02;
const SCORE_MAX = 0.98;

/** Induction baseline proximity per class: negative clips start far from the
 *  calm/positive target; calm clips start close to it. */
const BASELINE_RANGE: Record<ParadigmEmotion, [number, number]> = {
  anxiety: [0.22, 0.42],
  depression: [0.2, 0.4],
  fear: [0.18, 0.38],
  calm: [0.55, 0.72],
  happy: [0.55, 0.72],
};

function clampScore(value: number) {
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, value));
}

/**
 * Simulates one regulation trial. The walk drifts upward (reappraisal
 * "succeeds" on average) with per-step noise; the reported regulation score
 * averages the second half of the trajectory, mirroring a decoder whose
 * estimate settles after strategy uptake.
 */
export function simulateRegulationFeedback(
  emotion: ParadigmEmotion,
  random: () => number = Math.random,
): RegulationFeedbackSample {
  const [low, high] = BASELINE_RANGE[emotion];
  const baselineScore = low + random() * (high - low);

  // ~0.14 total drift across the window plus small noise per decode step.
  const driftPerStep = 0.009 + random() * 0.008;
  const trajectory: number[] = [];
  let value = baselineScore;
  for (let step = 0; step < REGULATION_DECODE_STEPS; step += 1) {
    value = clampScore(value + driftPerStep + (random() - 0.5) * 0.05);
    trajectory.push(value);
  }

  const secondHalf = trajectory.slice(Math.floor(trajectory.length / 2));
  const regulationScore = secondHalf.reduce((total, item) => total + item, 0) / secondHalf.length;
  const deltaScore = regulationScore - baselineScore;

  return { baselineScore, regulationScore, deltaScore, trajectory };
}

/** Aggregates per-trial stats into the session-level regulation summary. */
export function summarizeRegulationFeedback(
  stats: RegulationFeedbackStat[],
): RegulationFeedbackSummary {
  if (stats.length === 0) {
    return {
      totalTrials: 0,
      baselineMean: 0,
      regulationMean: 0,
      deltaMean: 0,
      improvedTrials: 0,
    };
  }

  const mean = (values: number[]) =>
    values.reduce((total, value) => total + value, 0) / values.length;

  return {
    totalTrials: stats.length,
    baselineMean: mean(stats.map((stat) => stat.baselineScore)),
    regulationMean: mean(stats.map((stat) => stat.regulationScore)),
    deltaMean: mean(stats.map((stat) => stat.deltaScore)),
    improvedTrials: stats.filter((stat) => stat.deltaScore > 0).length,
  };
}
