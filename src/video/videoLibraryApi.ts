import { invoke } from '@tauri-apps/api/core';
import type { VideoRegulationAsset } from './videoRegulationCatalog';

export type VideoLibrary = {
  assets: VideoRegulationAsset[];
  indexPath: string;
  root: string;
};

export function loadVideoLibrary(folderPath: string) {
  return invoke<VideoLibrary>('load_video_library', { folderPath });
}
