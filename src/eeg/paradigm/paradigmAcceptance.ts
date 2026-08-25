import type { ParadigmEmotion } from './types';

export type ParadigmAcceptanceOutcome = 'accepted' | 'uncertain' | 'rejected';

type RegionPredicate = (valence: number, arousal: number) => boolean;

/**
 * Acceptance regions per emotion on the 1-9 valence/arousal plane. This pure
 * function mirrors the backend rule one-to-one; the verdict order is:
 * own region -> accepted, near-boundary -> uncertain, other emotion's region
 * -> rejected, extra rejection rules -> rejected, everything else ->
 * uncertain.
 */
const OWN_REGIONS: Record<ParadigmEmotion, RegionPredicate> = {
  depression: (v, a) => v <= 4 && a <= 5,
  anxiety: (v, a) => v <= 4 && a >= 6,
  calm: (v, a) => v >= 5 && a <= 4,
  happy: (v, a) => v >= 6 && a >= 5 && a <= 8,
};

/** Bands adjacent to the own region that are too close to call. */
const BOUNDARY_REGIONS: Record<ParadigmEmotion, RegionPredicate> = {
  depression: (v, a) => (v <= 4 && a === 6) || (v === 5 && a <= 5),
  anxiety: (v, a) => (v <= 4 && a === 5) || (v === 5 && a >= 6),
  calm: (v, a) => (v === 4 && a <= 4) || (v >= 5 && a === 5),
  happy: (v, a) => (v === 5 && a >= 5 && a <= 8) || (v >= 6 && a === 4),
};

/** Additional hard rejections that override the uncertain fallback. */
const EXTRA_REJECTIONS: Record<ParadigmEmotion, RegionPredicate> = {
  depression: (v) => v >= 7,
  anxiety: () => false,
  calm: (v, a) => a >= 6 || v <= 3,
  happy: (v, a) => v <= 4 || a >= 9,
};

const ALL_EMOTIONS: readonly ParadigmEmotion[] = ['depression', 'anxiety', 'calm', 'happy'];

export function evaluateParadigmAcceptance(
  emotion: ParadigmEmotion,
  valence: number,
  arousal: number,
): ParadigmAcceptanceOutcome {
  if (OWN_REGIONS[emotion](valence, arousal)) {
    return 'accepted';
  }

  if (BOUNDARY_REGIONS[emotion](valence, arousal)) {
    return 'uncertain';
  }

  const insideOtherRegion = ALL_EMOTIONS.some((candidate) => (
    candidate !== emotion && OWN_REGIONS[candidate](valence, arousal)
  ));
  if (insideOtherRegion) {
    return 'rejected';
  }

  if (EXTRA_REJECTIONS[emotion](valence, arousal)) {
    return 'rejected';
  }

  return 'uncertain';
}
