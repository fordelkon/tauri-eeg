import { open } from '@tauri-apps/plugin-dialog';
import { loadVideoLibrary } from './videoLibraryApi';

export async function chooseVideoLibraryFolder() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择视频库文件夹',
  });

  if (typeof selected !== 'string') {
    return null;
  }

  return loadVideoLibrary(selected);
}
