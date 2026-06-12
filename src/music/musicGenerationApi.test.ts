import { invoke } from '@tauri-apps/api/core';
import { describe, expect, it, vi } from 'vitest';
import { getMusicServiceHealth, preloadMusicService } from './musicGenerationApi';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((filePath: string) => `asset://${filePath}`),
  invoke: vi.fn(),
}));

describe('getMusicServiceHealth', () => {
  it('loads the current music service device from Tauri', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      device: 'cuda',
      gpuAvailable: true,
      modelLoaded: true,
      modelVersion: 'stable-audio-3-small-music',
      status: 'ready',
    });

    await expect(getMusicServiceHealth()).resolves.toMatchObject({
      device: 'cuda',
      gpuAvailable: true,
      status: 'ready',
    });
    expect(invoke).toHaveBeenCalledWith('get_music_service_health');
  });
});

describe('preloadMusicService', () => {
  it('starts the music service through the health command before generation', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      device: 'cuda',
      gpuAvailable: true,
      modelLoaded: true,
      modelVersion: 'stable-audio-3-small-music',
      status: 'ready',
    });

    await expect(preloadMusicService()).resolves.toMatchObject({
      device: 'cuda',
      modelLoaded: true,
    });
    expect(invoke).toHaveBeenCalledWith('get_music_service_health');
  });

  it('swallows preload failures so the page can still render', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('service unavailable'));

    await expect(preloadMusicService()).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith('get_music_service_health');
  });
});
