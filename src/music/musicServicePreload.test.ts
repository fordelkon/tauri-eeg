import { describe, expect, it, vi } from 'vitest';
import { preloadMusicServiceForUser } from './musicServicePreload';
import type { MusicServiceHealth } from './musicGenerationApi';

describe('preloadMusicServiceForUser', () => {
  it('preloads the music service for a signed-in user and reports the device', async () => {
    const onDeviceDetected = vi.fn();
    const preload = vi.fn<() => Promise<MusicServiceHealth | null>>().mockResolvedValue({
      device: 'cuda',
      gpuAvailable: true,
      modelLoaded: true,
      modelVersion: 'stable-audio-3-small-music',
      status: 'ready',
    });

    await preloadMusicServiceForUser({ userId: 'user-1', onDeviceDetected, preload });

    expect(preload).toHaveBeenCalledOnce();
    expect(onDeviceDetected).toHaveBeenCalledWith('cuda');
  });

  it('does not preload without a signed-in user', async () => {
    const preload = vi.fn<() => Promise<MusicServiceHealth | null>>();

    await preloadMusicServiceForUser({ userId: null, preload });

    expect(preload).not.toHaveBeenCalled();
  });
});
