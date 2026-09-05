import { useEffect, useMemo, useState } from 'react';
import { loadParadigmVideoLibrary } from '../../eeg/paradigm/paradigmApi';
import { readStoredLibraryRootPath } from '../../eeg/paradigm/paradigmStorage';
import type { ParadigmVideoEntry } from '../../eeg/paradigm/types';
import {
  describeInductionPoolStatus,
  paradigmPoolKeyForEmotion,
  type InductionPoolStatus,
} from './effectInductionPool';

/**
 * Induction-step video pool for the effect-evaluation wizard (R6): loads the
 * entries of the target emotion's class in the video_paradigm library
 * whenever the induction step becomes visible and derives the pure pool
 * status from them. A missing/invalid library degrades to null and the pure
 * status helper turns that into an explicit blocked copy.
 */
export function useEffectInductionPool(
  emotion: 'anxiety' | 'depression' | 'fear',
  step: number,
): {
  inductionStatus: InductionPoolStatus;
  isInductionPoolLoading: boolean;
} {
  // null = no valid library / unusable pool.
  const [inductionPool, setInductionPool] = useState<readonly ParadigmVideoEntry[] | null>(null);
  const [isInductionPoolLoading, setIsInductionPoolLoading] = useState(false);

  // Load the pool when the induction step becomes visible (R6): the
  // video_paradigm library root stored by the EEG acquisition page feeds the
  // emotion's entries.
  useEffect(() => {
    if (step !== 1) {
      return undefined;
    }

    const rootPath = readStoredLibraryRootPath();
    // R8: every wizard emotion maps onto a scheduled paradigm class.
    const poolKey = paradigmPoolKeyForEmotion(emotion);

    if (rootPath.length === 0) {
      setInductionPool(null);
      setIsInductionPoolLoading(false);
      return undefined;
    }

    let cancelled = false;
    setIsInductionPoolLoading(true);

    void loadParadigmVideoLibrary(rootPath)
      .then((library) => {
        if (cancelled) {
          return;
        }

        setInductionPool(library.valid ? (library[poolKey] ?? null) : null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setInductionPool(null);
      })
      .finally(() => {
        if (!cancelled) {
          setIsInductionPoolLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [emotion, step]);

  // The pool entry is picked once per (emotion, pool); the memo keeps the
  // pick stable across re-renders of the step.
  const inductionStatus: InductionPoolStatus = useMemo(
    () => describeInductionPoolStatus(emotion, inductionPool),
    [emotion, inductionPool],
  );

  return { inductionStatus, isInductionPoolLoading };
}
