import { invoke } from '@tauri-apps/api/core';
import { describe, expect, it, vi } from 'vitest';
import { getMusicServiceHealth } from './musicGenerationApi';

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
