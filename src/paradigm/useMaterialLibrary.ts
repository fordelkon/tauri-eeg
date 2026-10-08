import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createMaterialLibraryLoader } from './materialLibraryLoader';
import { loadParadigmVideoLibrary } from './paradigmApi';

export function useMaterialLibraryLoader() {
  const loader = useMemo(() => createMaterialLibraryLoader(loadParadigmVideoLibrary), []);
  const state = useSyncExternalStore(loader.subscribe, loader.getSnapshot);
  useEffect(() => () => loader.cancel(), [loader]);
  return { loader, state };
}

export function useMaterialLibrary(rootPath: string | null) {
  const { loader, state } = useMaterialLibraryLoader();
  useEffect(() => {
    if (rootPath !== null) void loader.load(rootPath);
    return () => loader.cancel();
  }, [loader, rootPath]);
  if (rootPath !== null && state.kind !== 'idle' && state.rootPath !== rootPath) {
    return { kind: 'loading', rootPath } satisfies typeof state;
  }
  return state;
}
