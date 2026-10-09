import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultParadigmLibraryRootPath,
  readStoredLibraryRootPath,
  writeStoredLibraryRootPath,
} from './paradigmStorage';

function stubLocalStorage(localStorage: unknown) {
  vi.stubGlobal('window', { localStorage });
}

function makeMapStorage() {
  const entries = new Map<string, string>();

  return {
    getItem: (key: string) => (entries.has(key) ? (entries.get(key) ?? null) : null),
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readStoredLibraryRootPath / writeStoredLibraryRootPath', () => {
  it('round-trips a stored root path', () => {
    stubLocalStorage(makeMapStorage());

    expect(readStoredLibraryRootPath()).toBe(defaultParadigmLibraryRootPath);
    writeStoredLibraryRootPath('D:\\paradigm-videos');
    expect(readStoredLibraryRootPath()).toBe('D:\\paradigm-videos');
  });

  it('overwrites a previously stored root path', () => {
    const storage = makeMapStorage();
    stubLocalStorage(storage);

    writeStoredLibraryRootPath('D:\\old');
    writeStoredLibraryRootPath('E:\\new');
    expect(readStoredLibraryRootPath()).toBe('E:\\new');
  });

  it('falls back to the bundled library when localStorage is missing', () => {
    stubLocalStorage(undefined);

    expect(readStoredLibraryRootPath()).toBe(defaultParadigmLibraryRootPath);
    expect(() => writeStoredLibraryRootPath('D:\\x')).not.toThrow();
  });

  it('degrades silently when window itself is absent (node/test env)', () => {
    vi.stubGlobal('window', undefined);

    expect(readStoredLibraryRootPath()).toBe(defaultParadigmLibraryRootPath);
    expect(() => writeStoredLibraryRootPath('D:\\x')).not.toThrow();
  });

  it('swallows storage access failures such as privacy-mode denials', () => {
    stubLocalStorage({
      getItem: () => {
        throw new Error('access denied');
      },
      setItem: () => {
        throw new Error('access denied');
      },
    });

    expect(readStoredLibraryRootPath()).toBe(defaultParadigmLibraryRootPath);
    expect(() => writeStoredLibraryRootPath('D:\\x')).not.toThrow();
  });
});
