import { useEffect } from 'react';

export const TEST_SKIP_LABEL = 'Ctrl+Shift+S';

/** Only mounted by an active rehearsal stimulus. Ignore held keys and IME input. */
export function useTestSkip(enabled: boolean, skip: () => unknown) {
  useEffect(() => {
    if (!enabled) return;
    function handleKey(event: KeyboardEvent) {
      if (
        event.code !== 'KeyS' ||
        !event.ctrlKey ||
        !event.shiftKey ||
        event.altKey ||
        event.metaKey ||
        event.repeat ||
        event.isComposing ||
        event.defaultPrevented
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      skip();
    }
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [enabled, skip]);
}
