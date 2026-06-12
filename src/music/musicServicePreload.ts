import { preloadMusicService, type MusicServiceHealth } from './musicGenerationApi';

type PreloadMusicServiceForUserInput = {
  onDeviceDetected?: (device: string) => void;
  preload?: () => Promise<MusicServiceHealth | null>;
  userId: string | null | undefined;
};

export async function preloadMusicServiceForUser({
  onDeviceDetected,
  preload = preloadMusicService,
  userId,
}: PreloadMusicServiceForUserInput): Promise<void> {
  if (!userId) {
    return;
  }

  const health = await preload();
  if (!health) {
    return;
  }

  onDeviceDetected?.(health.device || (health.gpuAvailable ? 'cuda' : 'cpu'));
}
