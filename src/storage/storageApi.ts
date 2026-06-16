import { invoke } from '@tauri-apps/api/core';

export type StorageLocation = {
  root: string;
};

export function getStorageLocation() {
  return invoke<StorageLocation>('get_storage_location');
}

export function setStorageRoot(customRoot: string | null) {
  return invoke<StorageLocation>('set_storage_root', { customRoot });
}
