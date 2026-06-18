import { describe, expect, it } from 'vitest';
import { eegWaveHexLogoAnimation } from './eegWaveHexLogoAnimation';

describe('eegWaveHexLogoAnimation', () => {
  it('defines an EEG wave hex logo lottie animation', () => {
    const layerNames = eegWaveHexLogoAnimation.layers.map((layer) => layer.nm);
    const waveLayer = eegWaveHexLogoAnimation.layers.find((layer) => layer.nm === 'eeg-wave');
    const wavePath = waveLayer?.shapes[0]?.it[0]?.ks.k.v;

    expect(eegWaveHexLogoAnimation.v).toBeTruthy();
    expect(eegWaveHexLogoAnimation.w).toBe(360);
    expect(eegWaveHexLogoAnimation.h).toBe(360);
    expect(eegWaveHexLogoAnimation.fr).toBe(60);
    expect(layerNames).toEqual(expect.arrayContaining([
      'hex-radar',
      'inner-radar',
      'eeg-wave',
      'center-core',
      'neural-node-top',
      'neural-node-right',
      'neural-node-bottom',
      'neural-node-left',
    ]));
    expect(JSON.stringify(eegWaveHexLogoAnimation)).toContain('"ty":"st"');
    expect(JSON.stringify(eegWaveHexLogoAnimation)).toContain('"ty":"fl"');
    expect(wavePath?.length).toBeGreaterThanOrEqual(24);
    expect(wavePath?.[0]).toEqual([-170, 0]);
    expect(wavePath?.[wavePath.length - 1]).toEqual([170, 0]);
    expect(wavePath?.some((point) => Math.abs(point[1]) > 42)).toBe(false);
  });
});
