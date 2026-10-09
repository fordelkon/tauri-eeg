import type { ParadigmVideoLibrary } from './types';

export type MaterialLibraryState =
  | { kind: 'idle' }
  | { kind: 'loading'; rootPath: string }
  | { kind: 'ready' | 'invalid'; rootPath: string; library: ParadigmVideoLibrary }
  | { kind: 'failed'; rootPath: string; error: unknown };

export function createMaterialLibraryLoader(
  scan: (rootPath: string) => Promise<ParadigmVideoLibrary>,
) {
  let state: MaterialLibraryState = { kind: 'idle' };
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: MaterialLibraryState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel() {
      generation += 1;
      if (state.kind === 'loading') publish({ kind: 'idle' });
    },
    async load(rootPath: string): Promise<MaterialLibraryState | null> {
      const request = ++generation;
      if (!rootPath) {
        const empty: MaterialLibraryState = { kind: 'idle' };
        publish(empty);
        return empty;
      }

      publish({ kind: 'loading', rootPath });
      let result: MaterialLibraryState;
      try {
        const library = await scan(rootPath);
        result = { kind: library.valid ? 'ready' : 'invalid', rootPath, library };
      } catch (error) {
        result = { kind: 'failed', rootPath, error };
      }
      if (request !== generation) return null;
      publish(result);
      return result;
    },
  };
}
