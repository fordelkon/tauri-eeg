import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { GeneratedMusicHistoryItem } from './musicAssets';

export const MUSIC_GENERATED_EVENT = 'music:generated';

export type GenerateMusicInput = {
  duration: number;
  prompt: string;
  userId: string;
  username: string;
};

export type MusicServiceHealth = {
  device: string;
  error?: string | null;
  gpuAvailable: boolean;
  modelLoaded: boolean;
  modelVersion: string;
  status: string;
};

export async function generateMusic(input: GenerateMusicInput): Promise<GeneratedMusicHistoryItem> {
  const item = await invoke<GeneratedMusicHistoryItem>('generate_music', { input });

  if (typeof dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    dispatchEvent(new CustomEvent<GeneratedMusicHistoryItem>(MUSIC_GENERATED_EVENT, { detail: item }));
  }

  return item;
}

export async function getMusicServiceHealth(): Promise<MusicServiceHealth> {
  return invoke<MusicServiceHealth>('get_music_service_health');
}

export async function preloadMusicService(): Promise<MusicServiceHealth | null> {
  try {
    return await getMusicServiceHealth();
  } catch {
    return null;
  }
}

export async function listMusicHistory(
  userId: string,
  limit = 50,
): Promise<GeneratedMusicHistoryItem[]> {
  return invoke<GeneratedMusicHistoryItem[]>('list_music_history', { userId, limit });
}

export async function deleteMusicHistoryItem(
  userId: string,
  itemId: string,
): Promise<GeneratedMusicHistoryItem> {
  return invoke<GeneratedMusicHistoryItem>('delete_music_history', {
    input: {
      itemId,
      userId,
    },
  });
}

export function toPlayableFileUrl(filePath: string) {
  return convertFileSrc(filePath);
}
