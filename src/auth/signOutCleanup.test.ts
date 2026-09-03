// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clearUserSessionState } from './signOutCleanup';
import {
  createEffectEvaluationFlowState,
  FLOW_STORAGE_KEY,
  readFlowStateFromStorage,
  writeFlowStateToStorage,
} from '../pages/home/effectEvaluationFlow';
import {
  isScaleSatisfiedForPath,
  recordScaleCompletion,
  recordScaleSkip,
} from '../mentalScale/scaleCompletion';
import { readStoredSubjectId, SUBJECT_ID_STORAGE_KEY, writeStoredSubjectId } from '../storage/currentSubject';

type MemoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function createMemoryStorage(): MemoryStorage {
  const entries = new Map<string, string>();

  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

describe('clearUserSessionState', () => {
  it('discards the running effect-evaluation wizard state', () => {
    const sessionStorage = createMemoryStorage();
    const state = createEffectEvaluationFlowState();
    state.step = 3;
    state.regulationStartedAtMs = 1_000;
    writeFlowStateToStorage(sessionStorage, state);
    expect(readFlowStateFromStorage(sessionStorage)).not.toBeNull();

    clearUserSessionState(sessionStorage, createMemoryStorage());

    expect(sessionStorage.getItem(FLOW_STORAGE_KEY)).toBeNull();
    expect(readFlowStateFromStorage(sessionStorage)).toBeNull();
  });

  it('clears the shared subject-id memory so the next user starts unbound', () => {
    const subjectStorage = createMemoryStorage();
    writeStoredSubjectId('subj-user-a', subjectStorage);
    expect(readStoredSubjectId(subjectStorage)).toBe('subj-user-a');

    clearUserSessionState(createMemoryStorage(), subjectStorage);

    expect(subjectStorage.getItem(SUBJECT_ID_STORAGE_KEY)).toBeNull();
    expect(readStoredSubjectId(subjectStorage)).toBe('');
  });

  it('re-arms the scale gate: neither a skip pass nor a grace window survives', () => {
    const t0 = 1_000_000;
    recordScaleSkip('/music-regulation');
    recordScaleCompletion('/video-regulation', t0);
    expect(isScaleSatisfiedForPath('/music-regulation', t0)).toBe(true);
    expect(isScaleSatisfiedForPath('/video-regulation', t0 + 1000)).toBe(true);

    clearUserSessionState(createMemoryStorage(), createMemoryStorage());

    expect(isScaleSatisfiedForPath('/music-regulation', t0)).toBe(false);
    expect(isScaleSatisfiedForPath('/video-regulation', t0 + 1000)).toBe(false);
  });

  // Wiring guard, in the repo's readFileSync convention: the cleanup helpers
  // exist, but the bug lived in signOut not calling them.
  it('is called from AuthContext signOut', () => {
    const source = readFileSync(new URL('./AuthContext.tsx', import.meta.url), 'utf8');

    expect(source).toContain('clearUserSessionState();');
  });
});
