/**
 * Best-effort localStorage persistence for the regulation video library root
 * (mirrors the paradigm setup memory). Storage may be unavailable — private
 * browsing, sandboxed WebView, quota errors — so every access is guarded and
 * degrades silently to "not stored".
 */

const LIBRARY_ROOT_PATH_STORAGE_KEY = 'video.libraryRootPath';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function resolveStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Reading the localStorage property itself can throw in some privacy modes.
    return null;
  }
}

/** Last loaded video library root path, or '' when none was stored. */
export function readStoredLibraryRootPath(): string {
  try {
    return resolveStorage()?.getItem(LIBRARY_ROOT_PATH_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeStoredLibraryRootPath(value: string) {
  try {
    resolveStorage()?.setItem(LIBRARY_ROOT_PATH_STORAGE_KEY, value);
  } catch {
    // Persistence is best-effort and silent.
  }
}
