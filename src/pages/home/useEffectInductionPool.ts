import { useMemo } from 'react';
import { useMaterialLibrary } from '../../paradigm/useMaterialLibrary';
import { readStoredLibraryRootPath } from '../../paradigm/paradigmStorage';
import {
  describeInductionPoolStatus,
  paradigmPoolKeyForEmotion,
  type InductionPoolStatus,
} from './effectInductionPool';

export function useEffectInductionPool(
  emotion: 'anxiety' | 'depression' | 'fear',
  step: number,
): {
  inductionStatus: InductionPoolStatus;
  isInductionPoolLoading: boolean;
} {
  const library = useMaterialLibrary(step === 1 ? readStoredLibraryRootPath() : null);
  const pool =
    library.kind === 'ready' ? library.library[paradigmPoolKeyForEmotion(emotion)] : null;
  const inductionStatus = useMemo(
    () => describeInductionPoolStatus(emotion, pool),
    [emotion, pool],
  );
  return { inductionStatus, isInductionPoolLoading: library.kind === 'loading' };
}
