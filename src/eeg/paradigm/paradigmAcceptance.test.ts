import { describe, expect, it } from 'vitest';
import { evaluateParadigmAcceptance } from './paradigmAcceptance';

describe('evaluateParadigmAcceptance', () => {
  it('accepts self-reports inside the own emotion region', () => {
    expect(evaluateParadigmAcceptance('depression', 3, 3)).toBe('accepted');
    expect(evaluateParadigmAcceptance('anxiety', 2, 8)).toBe('accepted');
    expect(evaluateParadigmAcceptance('calm', 6, 2)).toBe('accepted');
    expect(evaluateParadigmAcceptance('happy', 7, 6)).toBe('accepted');
    expect(evaluateParadigmAcceptance('fear', 2, 8)).toBe('accepted');
  });

  it('marks near-boundary self-reports as uncertain', () => {
    expect(evaluateParadigmAcceptance('depression', 3, 6)).toBe('uncertain');
    expect(evaluateParadigmAcceptance('depression', 5, 3)).toBe('uncertain');
    expect(evaluateParadigmAcceptance('anxiety', 3, 5)).toBe('uncertain');
    expect(evaluateParadigmAcceptance('calm', 5, 5)).toBe('uncertain');
    expect(evaluateParadigmAcceptance('calm', 4, 2)).toBe('uncertain');
    expect(evaluateParadigmAcceptance('happy', 5, 6)).toBe('uncertain');
    // Provisional fear boundary band (v <= 3 && a === 6) / (v === 4 && a >= 7);
    // (5, 8) falls to uncertain via the catch-all, not any band.
    expect(evaluateParadigmAcceptance('fear', 2, 6)).toBe('uncertain');
    expect(evaluateParadigmAcceptance('fear', 4, 8)).toBe('uncertain');
    expect(evaluateParadigmAcceptance('fear', 5, 8)).toBe('uncertain');
  });

  it('rejects self-reports inside another emotion region', () => {
    expect(evaluateParadigmAcceptance('depression', 7, 5)).toBe('rejected');
    expect(evaluateParadigmAcceptance('anxiety', 5, 2)).toBe('rejected');
    expect(evaluateParadigmAcceptance('calm', 6, 7)).toBe('rejected');
    expect(evaluateParadigmAcceptance('happy', 3, 7)).toBe('rejected');
    // (6, 2) sits in the calm region; the fear own/boundary bands miss it.
    expect(evaluateParadigmAcceptance('fear', 6, 2)).toBe('rejected');
  });

  it('applies the extra rejection rules beyond region overlap', () => {
    // (8, 9) is outside every region; happy's arousal >= 9 rule rejects it.
    expect(evaluateParadigmAcceptance('happy', 8, 9)).toBe('rejected');
    // Fear's provisional hard reject: clearly positive valence (研究组可调临时口径).
    expect(evaluateParadigmAcceptance('fear', 8, 8)).toBe('rejected');
  });

  it('covers the full valence/arousal grid with a stable verdict', () => {
    // Sampling every cell keeps the mirror in sync with the backend contract.
    const counts: Record<string, number> = {
      accepted: 0,
      rejected: 0,
      uncertain: 0,
    };
    const emotions = ['depression', 'anxiety', 'calm', 'fear', 'happy'] as const;

    for (const emotion of emotions) {
      for (let valence = 1; valence <= 9; valence += 1) {
        for (let arousal = 1; arousal <= 9; arousal += 1) {
          counts[evaluateParadigmAcceptance(emotion, valence, arousal)] += 1;
        }
      }
    }

    // 5 emotions x 81 cells = 405 verdicts, all accounted for.
    expect(counts.accepted + counts.rejected + counts.uncertain).toBe(405);
  });

  it('keeps boundary checks ahead of other-region rejection', () => {
    // (4, 2) is inside the depression region, but calm's own boundary band
    // (v === 4 && a <= 4) is evaluated first and must win as uncertain.
    expect(evaluateParadigmAcceptance('calm', 4, 2)).toBe('uncertain');
  });
});
