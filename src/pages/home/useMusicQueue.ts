import { useEffect, useMemo, useRef, useState } from 'react';
import { toPlayableFileUrl } from '../../music/musicGenerationApi';
import { createBundledMusicAssets, createGeneratedMusicAsset } from '../../music/musicAssets';
import { bundledMusicFiles } from './musicRegulationOptions';
import { useMusicHistory } from './useMusicHistory';

/**
 * Playback queue for the music regulation page: the generated + bundled
 * asset list, the active index, the play/pause state, and the next-track
 * prewarm. Owns the shared music-history load (same loader the embedded
 * effect player uses) so the page keeps only generation and tag logic.
 */
export function useMusicQueue(options: {
  userId: string | undefined;
  /** History load failure (raw reason; the page applies the friendly copy). */
  onLoadError: (reason: unknown) => void;
  /** Playback refusal, already user-facing copy. */
  onPlaybackError: (message: string) => void;
}) {
  const { userId, onLoadError, onPlaybackError } = options;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bundledAssets = useMemo(() => createBundledMusicAssets(bundledMusicFiles), []);
  const { items: generatedItems, setItems: setGeneratedItems } = useMusicHistory({ userId, onError: onLoadError });
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const generatedAssets = useMemo(
    () => generatedItems.map((item) => createGeneratedMusicAsset(item, toPlayableFileUrl)),
    [generatedItems],
  );
  const assets = useMemo(
    () => [...generatedAssets, ...bundledAssets],
    [bundledAssets, generatedAssets],
  );
  const activeAsset = assets[activeIndex];
  // Next track in the queue (no wrap): prewarming it removes the fetch wait
  // from the `ended` → next-track transition.
  const nextAsset = assets[activeIndex + 1];

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  // Prewarms the next queue entry through a detached <audio> element so its
  // multi-MB WAV is already fetched (HTTP-cached) when `ended` advances the
  // active element — no audible gap between tracks. mediaUrl is the already
  // converted playable URL (convertFileSrc for generated assets), so the
  // prewarm element hits the exact same resource. The effect's cleanup aborts
  // any in-flight fetch by dropping the src; the element is released on unmount.
  const prewarmAudioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const prewarm = prewarmAudioRef.current ?? new Audio();
    prewarmAudioRef.current = prewarm;
    prewarm.preload = 'auto';
    prewarm.src = nextAsset?.mediaUrl ?? '';

    return () => {
      prewarm.pause();
      prewarm.removeAttribute('src');
      prewarm.load();
    };
  }, [nextAsset]);

  useEffect(() => () => {
    prewarmAudioRef.current?.pause();
    prewarmAudioRef.current = null;
  }, []);

  useEffect(() => {
    if (activeIndex >= assets.length) {
      setActiveIndex(Math.max(0, assets.length - 1));
    }
  }, [activeIndex, assets.length]);

  const playActiveAudio = async () => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    try {
      await audio.play();
    } catch {
      onPlaybackError('无法播放音频，请检查音频文件或系统音频权限。');
    }
  };

  const handleTogglePlay = async () => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      await playActiveAudio();
    } else {
      audio.pause();
    }
  };

  const handleTrackChange = async (nextIndex: number) => {
    const audio = audioRef.current;
    const shouldResume = Boolean(audio && !audio.paused);
    if (assets.length === 0) {
      return;
    }

    setActiveIndex((nextIndex + assets.length) % assets.length);

    if (shouldResume) {
      window.setTimeout(() => {
        void playActiveAudio();
      }, 0);
    }
  };

  return {
    activeAsset,
    activeIndex,
    assets,
    audioRef,
    handleTogglePlay,
    handleTrackChange,
    isPlaying,
    playActiveAudio,
    setActiveIndex,
    setGeneratedItems,
    setIsPlaying,
  };
}
