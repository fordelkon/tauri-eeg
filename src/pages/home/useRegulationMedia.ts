import { useEffect, type RefObject } from 'react';

/**
 * Pauses the media element behind `ref` whenever `changeKey` changes (and on
 * unmount); a removed <video>/<audio> element would otherwise keep decoding.
 * Shared by the standalone video page and the embedded regulation players —
 * all three owned the identical guard effect.
 *
 * Read-at-effect-start semantics: the element current when `changeKey`
 * becomes the new value is the one paused. Pass a stable key to get an
 * unmount-only pause.
 */
export function usePauseMediaOnChange(
  ref: RefObject<HTMLVideoElement | HTMLAudioElement | null>,
  changeKey: string | number | null | undefined,
) {
  useEffect(() => {
    const media = ref.current;

    return () => {
      media?.pause();
    };
  }, [ref, changeKey]);
}
