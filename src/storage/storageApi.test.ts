import { invoke } from '@tauri-apps/api/core';
import { describe, expect, it, vi } from 'vitest';
import { getStorageLocation, setStorageRoot } from './storageApi';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('storageApi', () => {
  it('loads resolved storage location', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      root: 'D:/ExperimentData',
    });

    await expect(getStorageLocation()).resolves.toMatchObject({
      root: 'D:/ExperimentData',
    });
    expect(invoke).toHaveBeenCalledWith('get_storage_location');
  });

  it('sets custom storage root', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      root: 'D:/ExperimentData',
    });

    await setStorageRoot('D:/ExperimentData');

    expect(invoke).toHaveBeenCalledWith('set_storage_root', {
      customRoot: 'D:/ExperimentData',
    });
  });
});
