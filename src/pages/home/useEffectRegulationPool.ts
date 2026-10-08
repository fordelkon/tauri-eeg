import { useMemo } from 'react';
import { useMaterialLibrary } from '../../paradigm/useMaterialLibrary';
import { readStoredLibraryRootPath } from '../../paradigm/paradigmStorage';
import { describeRegulationPoolStatus, type RegulationPoolStatus } from './effectRegulationPool';

export function useEffectRegulationPool(
  enabled: boolean,
  step: number,
): {
  isRegulationPoolLoading: boolean;
  regulationPoolStatus: RegulationPoolStatus;
} {
  const active = enabled && step === 3;
  const library = useMaterialLibrary(active ? readStoredLibraryRootPath() : null);
  const pool = active && library.kind === 'ready' ? library.library.calm : null;
  return {
    isRegulationPoolLoading: active && library.kind === 'loading',
    regulationPoolStatus: useMemo(() => describeRegulationPoolStatus(pool), [pool]),
  };
}
