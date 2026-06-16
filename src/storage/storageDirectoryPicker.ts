import { open } from '@tauri-apps/plugin-dialog';
import { setStorageRoot } from './storageApi';

export async function chooseStorageRoot() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Choose storage root',
  });

  if (typeof selected !== 'string') {
    return null;
  }

  return setStorageRoot(selected);
}
