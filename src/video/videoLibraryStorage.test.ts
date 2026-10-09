// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readStoredLibraryRootPath,
  writeStoredLibraryRootPath,
  readStoredParadigmLibraryRootPath,
  writeStoredParadigmLibraryRootPath,
} from './videoLibraryStorage';
import { defaultParadigmLibraryRootPath } from '../paradigm/paradigmStorage';

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

describe('standalone paradigm video root memory', () => {
  it('defaults to the project paradigm folder and follows prepared roots until a standalone choice is saved', () => {
    const storage = makeMapStorage();
    stubLocalStorage(storage);
    expect(readStoredParadigmLibraryRootPath()).toBe(defaultParadigmLibraryRootPath);
    storage.setItem('paradigm.libraryRootPath', 'D:\\prepared-videos');
    expect(readStoredParadigmLibraryRootPath()).toBe('D:\\prepared-videos');
    writeStoredParadigmLibraryRootPath('D:\\standalone-videos');
    expect(readStoredParadigmLibraryRootPath()).toBe('D:\\standalone-videos');
    expect(storage.getItem('paradigm.libraryRootPath')).toBe('D:\\prepared-videos');
    writeStoredLibraryRootPath('D:\\legacy-indexed-library');
    expect(readStoredParadigmLibraryRootPath()).toBe('D:\\standalone-videos');
  });

  it('falls back safely when storage is unavailable or selection memory is blank', () => {
    const storage = makeMapStorage();
    stubLocalStorage(storage);
    writeStoredParadigmLibraryRootPath('  ');
    expect(readStoredParadigmLibraryRootPath()).toBe(defaultParadigmLibraryRootPath);
    vi.stubGlobal('window', undefined);
    expect(readStoredParadigmLibraryRootPath()).toBe(defaultParadigmLibraryRootPath);
    expect(() => writeStoredParadigmLibraryRootPath('D:\\videos')).not.toThrow();
  });
});

describe('readStoredLibraryRootPath / writeStoredLibraryRootPath', () => {
  it('round-trips a stored root path', () => {
    stubLocalStorage(makeMapStorage());

    expect(readStoredLibraryRootPath()).toBe('');
    writeStoredLibraryRootPath('D:\\video-database');
    expect(readStoredLibraryRootPath()).toBe('D:\\video-database');
  });

  it('overwrites a previously stored root path', () => {
    stubLocalStorage(makeMapStorage());

    writeStoredLibraryRootPath('D:\\old');
    writeStoredLibraryRootPath('E:\\new');
    expect(readStoredLibraryRootPath()).toBe('E:\\new');
  });

  it('uses an independent storage key from the paradigm library', () => {
    const source = readFileSync(new URL('./videoLibraryStorage.ts', import.meta.url), 'utf8');
    const paradigmSource = readFileSync(
      new URL('../paradigm/paradigmStorage.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain("'video.libraryRootPath'");
    expect(paradigmSource).toContain("'paradigm.libraryRootPath'");
  });

  it('degrades to empty reads when localStorage is missing', () => {
    stubLocalStorage(undefined);

    expect(readStoredLibraryRootPath()).toBe('');
    expect(() => writeStoredLibraryRootPath('D:\\x')).not.toThrow();
  });

  it('degrades silently when window itself is absent (node/test env)', () => {
    vi.stubGlobal('window', undefined);

    expect(readStoredLibraryRootPath()).toBe('');
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

    expect(readStoredLibraryRootPath()).toBe('');
    expect(() => writeStoredLibraryRootPath('D:\\x')).not.toThrow();
  });
});
