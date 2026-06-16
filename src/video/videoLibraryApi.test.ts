import { invoke } from '@tauri-apps/api/core';
import { describe, expect, it, vi } from 'vitest';
import { loadVideoLibrary } from './videoLibraryApi';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('videoLibraryApi', () => {
  it('loads a validated video library from a selected folder', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      assets: [],
      indexPath: 'D:\\videos\\video_library_tags.json',
      root: 'D:\\videos',
    });

    await expect(loadVideoLibrary('D:\\videos')).resolves.toMatchObject({
      indexPath: 'D:\\videos\\video_library_tags.json',
      root: 'D:\\videos',
    });

    expect(invoke).toHaveBeenCalledWith('load_video_library', {
      folderPath: 'D:\\videos',
    });
  });
});
