import { useEffect, useMemo, useState } from 'react';
import { loadParadigmVideoLibrary } from '../../eeg/paradigm/paradigmApi';
import { readStoredLibraryRootPath } from '../../eeg/paradigm/paradigmStorage';
import type { ParadigmVideoEntry } from '../../eeg/paradigm/types';
import { describeRegulationPoolStatus, type RegulationPoolStatus } from './effectRegulationPool';

/**
 * Loads the shared Calm pool before the condition window can start. Induction
 * keeps its target-emotion pool, while video regulation always receives calm
 * material from the same validated video_paradigm root.
 */
export function useEffectRegulationPool(
  enabled: boolean,
  step: number,
): {
  isRegulationPoolLoading: boolean;
  regulationPoolStatus: RegulationPoolStatus;
} {
  const [pool, setPool] = useState<readonly ParadigmVideoEntry[] | null>(null);
  const [isRegulationPoolLoading, setIsRegulationPoolLoading] = useState(false);

  useEffect(() => {
    if (!enabled || step !== 3) {
      setPool(null);
      setIsRegulationPoolLoading(false);
      return undefined;
    }

    let cancelled = false;
    setIsRegulationPoolLoading(true);

    void loadParadigmVideoLibrary(readStoredLibraryRootPath())
      .then((library) => {
        if (!cancelled) {
          setPool(library.valid ? library.calm : null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPool(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsRegulationPoolLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, step]);

  return {
    isRegulationPoolLoading,
    regulationPoolStatus: useMemo(() => describeRegulationPoolStatus(pool), [pool]),
  };
}
