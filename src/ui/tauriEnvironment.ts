/**
 * Runtime environment probe: the vite dev server also serves the app in a
 * plain browser, where every Tauri command rejects immediately. Device
 * failures there are the environment, not an operator-facing problem, so the
 * UI degrades to a calm notice instead of an error banner with a retry.
 */

/** True inside the Tauri webview (desktop app); false in a plain browser. */
export function isTauriAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
