import { open } from '@tauri-apps/plugin-dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseStorageRoot } from './storageDirectoryPicker';
import { setStorageRoot } from './storageApi';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

vi.mock('./storageApi', () => ({
  setStorageRoot: vi.fn(),
}));

describe('chooseStorageRoot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves the selected directory as the storage root', async () => {
    vi.mocked(open).mockResolvedValueOnce('D:\\ExperimentData');
    vi.mocked(setStorageRoot).mockResolvedValueOnce({
      root: 'D:\\ExperimentData',
    });

    await expect(chooseStorageRoot()).resolves.toEqual({
      root: 'D:\\ExperimentData',
    });

    expect(open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: 'Choose storage root',
    });
    expect(setStorageRoot).toHaveBeenCalledWith('D:\\ExperimentData');
  });

  it('does not save when the picker is cancelled', async () => {
    vi.mocked(open).mockResolvedValueOnce(null);

    await expect(chooseStorageRoot()).resolves.toBeNull();

    expect(setStorageRoot).not.toHaveBeenCalled();
  });
});
