import { useSyncExternalStore } from 'react';

/**
 * Module-level external store that mirrors whether a paradigm session is
 * live. It is the single source of truth for the global UI locks (sidebar
 * navigation, next-page button, storage settings, sign out) so Home.tsx and
 * the acquisition page never disagree about locking state.
 */
export type ParadigmSessionStatus = {
  active: boolean;
  phase: string;
  /** 1-based trial number shown to operators; 0 when no trial is active. */
  trialIndex: number;
  totalTrials: number;
};

export const defaultParadigmSessionStatus: ParadigmSessionStatus = {
  active: false,
  phase: 'idle',
  trialIndex: 0,
  totalTrials: 0,
};

type ParadigmSessionStatusListener = () => void;

let currentStatus: ParadigmSessionStatus = defaultParadigmSessionStatus;
const listeners = new Set<ParadigmSessionStatusListener>();

export function getParadigmSessionStatus(): ParadigmSessionStatus {
  return currentStatus;
}

export function subscribeParadigmSessionStatus(
  listener: ParadigmSessionStatusListener,
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function setParadigmSessionStatus(status: ParadigmSessionStatus): void {
  const isUnchanged = Object.keys(defaultParadigmSessionStatus).every(
    (key) => currentStatus[key as keyof ParadigmSessionStatus]
      === status[key as keyof ParadigmSessionStatus],
  );

  if (isUnchanged) {
    return;
  }

  currentStatus = status;
  for (const listener of listeners) {
    listener();
  }
}

export function useParadigmSessionStatus(): ParadigmSessionStatus {
  return useSyncExternalStore(
    subscribeParadigmSessionStatus,
    getParadigmSessionStatus,
    getParadigmSessionStatus,
  );
}
