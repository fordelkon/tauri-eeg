import { useEffect, useRef, useState } from 'react';
import type { GeneratedMusicHistoryItem } from '../../music/musicAssets';
import { listMusicHistory } from '../../music/musicGenerationApi';

/**
 * Shared music-history loader for the regulation surfaces that play generated
 * tracks (the music regulation page and the effect-evaluation embedded
 * player). Loads `listMusicHistory` once per user (plus every `reloadKey`
 * bump) and owns the mounted/cancelled guard; consumers keep their own error
 * presentation via `onError` and refresh via `setItems` (the page inserts
 * finished tracks from MUSIC_GENERATED_EVENT, the player retries).
 *
 * No user (logged out) clears the list instead of loading.
 */
export function useMusicHistory(options: {
  userId: string | undefined;
  limit?: number;
  reloadKey?: number;
  onError: (reason: unknown) => void;
}): {
  items: GeneratedMusicHistoryItem[];
  setItems: React.Dispatch<React.SetStateAction<GeneratedMusicHistoryItem[]>>;
  /** True from mount until the load settles (or when no user is signed in). */
  isLoading: boolean;
} {
  const { userId, limit, reloadKey = 0, onError } = options;
  const [items, setItems] = useState<GeneratedMusicHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(userId));
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      setIsLoading(false);
      return undefined;
    }

    let isMounted = true;
    setIsLoading(true);

    listMusicHistory(userId, limit)
      .then((loaded) => {
        if (isMounted) {
          setItems(loaded);
          setIsLoading(false);
        }
      })
      .catch((reason: unknown) => {
        if (isMounted) {
          setIsLoading(false);
          onErrorRef.current(reason);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [userId, limit, reloadKey]);

  return { items, setItems, isLoading };
}

