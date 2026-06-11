import { describe, expect, it } from 'vitest';
import { buildMusicPrompt } from './musicPrompt';

describe('buildMusicPrompt', () => {
  it('joins multiple single instruments without requiring preset combinations', () => {
    expect(buildMusicPrompt(['piano', 'violin'], '', ['ambient instrumental'], '', [], 'warm tone')).toBe(
      'piano, violin, ambient instrumental, warm tone, no vocals',
    );
  });

  it('joins multiple styles and detail templates before freeform details', () => {
    expect(buildMusicPrompt(
      ['guitar'],
      '',
      ['lo-fi instrumental', 'jazz instrumental'],
      '',
      ['slow tempo', 'warm tone'],
      'light reverb',
    )).toBe(
      'guitar, lo-fi instrumental, jazz instrumental, slow tempo, warm tone, light reverb, no vocals',
    );
  });
});
