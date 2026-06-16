import { open } from '@tauri-apps/plugin-dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseVideoLibraryFolder } from './videoDirectoryPicker';
import { loadVideoLibrary } from './videoLibraryApi';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

vi.mock('./videoLibraryApi', () => ({
  loadVideoLibrary: vi.fn(),
}));

describe('chooseVideoLibraryFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the selected video library folder', async () => {
    vi.mocked(open).mockResolvedValueOnce('D:\\videos');
    vi.mocked(loadVideoLibrary).mockResolvedValueOnce({
      assets: [],
      indexPath: 'D:\\videos\\video_library_tags.json',
      root: 'D:\\videos',
    });

    await expect(chooseVideoLibraryFolder()).resolves.toMatchObject({
      root: 'D:\\videos',
    });

    expect(open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: '选择视频库文件夹',
    });
    expect(loadVideoLibrary).toHaveBeenCalledWith('D:\\videos');
  });

  it('does not load a library when the picker is cancelled', async () => {
    vi.mocked(open).mockResolvedValueOnce(null);

    await expect(chooseVideoLibraryFolder()).resolves.toBeNull();

    expect(loadVideoLibrary).not.toHaveBeenCalled();
  });
});
