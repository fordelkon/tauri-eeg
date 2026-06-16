import { invoke } from '@tauri-apps/api/core';
import { describe, expect, it, vi } from 'vitest';
import { generateMusic, getMusicServiceHealth, preloadMusicService } from './musicGenerationApi';

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

describe('generateMusic', () => {
  it('generates music with user identity for user-scoped folders', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      createdAt: '2026-06-16T00:00:00Z',
      durationSeconds: 30,
      filePath: 'D:/ExperimentData/ikun/music/gen_job.wav',
      id: 'job-1',
      modelVersion: 'stable-audio-3-small-music',
      prompt: 'calm piano',
      userId: 'user-1',
    });

    await generateMusic({
      duration: 30,
      prompt: 'calm piano',
      userId: 'user-1',
      username: 'ikun',
    });

    expect(invoke).toHaveBeenCalledWith('generate_music', {
      input: {
        duration: 30,
        prompt: 'calm piano',
        userId: 'user-1',
        username: 'ikun',
      },
    });
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
