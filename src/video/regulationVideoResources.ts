import type { RegulationVideo } from './paradigmRegulationCatalog';

let currentVideos: readonly RegulationVideo[] = [];

export function getCurrentRegulationVideos(): readonly RegulationVideo[] {
  return currentVideos;
}

export function setCurrentRegulationVideos(videos: readonly RegulationVideo[]) {
  currentVideos = [...videos];
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('regulation-videos-updated'));
  }
}
