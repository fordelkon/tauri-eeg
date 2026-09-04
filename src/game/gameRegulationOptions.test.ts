import { describe, expect, it } from 'vitest';
import { gameRegulationOptions } from './gameRegulationOptions';

describe('gameRegulationOptions', () => {
  it('defines VR and AR placeholder entries with public images', () => {
    expect(gameRegulationOptions).toEqual([
      expect.objectContaining({
        id: 'vr-motion',
        imageSrc: '/game1.webp',
        mode: 'VR',
      }),
      expect.objectContaining({
        id: 'ar-breathing',
        imageSrc: '/game2.webp',
        mode: 'AR',
      }),
    ]);
  });
});
