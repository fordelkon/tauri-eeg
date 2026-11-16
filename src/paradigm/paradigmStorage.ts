/**
 * Best-effort localStorage persistence for paradigm setup values (E-Prime
 * StartupInfo style memory). Storage may be unavailable — private browsing,
 * sandboxed WebView, quota errors — so every access is guarded and degrades
 * silently to "not stored".
 */

const LIBRARY_ROOT_PATH_STORAGE_KEY = 'paradigm.libraryRootPath';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function toWindowsPath(path: string) {
  return path.replace(/\//g, '\\');
}

/**
 * The development checkout contains example stimuli. Installed applications
 * use the library selected and validated on the acquisition computer.
 */
export const defaultParadigmLibraryRootPath = __EXPERIMENT_DEV__
  ? `${toWindowsPath(__TAURI_EEG_PROJECT_ROOT__)}\\video_paradigm`
  : '';

function resolveStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Reading the localStorage property itself can throw in some privacy modes.
    return null;
  }
}

/**
 * Last validated paradigm video root path, or the build's initial value.
 */
export function readStoredLibraryRootPath(): string {
  try {
    return (
      resolveStorage()?.getItem(LIBRARY_ROOT_PATH_STORAGE_KEY)?.trim() ||
      defaultParadigmLibraryRootPath
    );
  } catch {
    return defaultParadigmLibraryRootPath;
  }
}

export function writeStoredLibraryRootPath(value: string) {
  try {
    resolveStorage()?.setItem(LIBRARY_ROOT_PATH_STORAGE_KEY, value);
  } catch {
    // Persistence is best-effort and silent.
  }
}
