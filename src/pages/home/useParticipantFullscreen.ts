import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useRef } from 'react';
import { isTauriAvailable } from '../../ui/tauriEnvironment';

type FullscreenOwner = 'none' | 'native-window' | 'document';

/**
 * Enters fullscreen from an explicit operator click. Native Tauri fullscreen
 * is preferred; a browser fullscreen request remains a useful fallback when
 * a webview exposes no native window bridge.
 */
export function useParticipantFullscreen() {
  const ownerRef = useRef<FullscreenOwner>('none');

  const leaveFullscreen = useCallback(() => {
    const owner = ownerRef.current;
    ownerRef.current = 'none';

    if (owner === 'native-window' && isTauriAvailable()) {
      void getCurrentWindow()
        .setFullscreen(false)
        .catch(() => {});
    }
    if (owner === 'document' && document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  const enterFullscreen = useCallback(async () => {
    if (isTauriAvailable()) {
      try {
        const appWindow = getCurrentWindow();
        const alreadyFullscreen = await appWindow.isFullscreen();
        if (!alreadyFullscreen) {
          await appWindow.setFullscreen(true);
          ownerRef.current = 'native-window';
        }
        return;
      } catch {
        // Fall through to the document API below.
      }
    }

    if (
      document.fullscreenElement ||
      typeof document.documentElement.requestFullscreen !== 'function'
    ) {
      return;
    }

    try {
      await document.documentElement.requestFullscreen();
      ownerRef.current = 'document';
    } catch {
      // The portal remains edge-to-edge when the host rejects fullscreen.
    }
  }, []);

  useEffect(() => leaveFullscreen, [leaveFullscreen]);

  return { enterFullscreen };
}
