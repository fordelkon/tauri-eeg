import { resetScaleCompletion } from '../mentalScale/scaleCompletion';
import { clearFlowStateFromStorage } from '../pages/home/effectEvaluationFlow';
import { clearStoredSubjectId, type SubjectIdStorage } from '../storage/currentSubject';

/**
 * Cross-user sign-out hygiene.
 *
 * `signOut` used to clear only the current user from localStorage; every
 * other per-user session marker survived the switch, so user B inherited
 * user A's half-run wizard, gate exemptions, and subject binding. This clears
 * the three state holders that outlive the auth session in the same webview:
 *
 * - the effect-evaluation wizard run (sessionStorage, resumes mid-run),
 * - the shared subject-id memory (localStorage, paradigm + scale records),
 * - the scale-gate completion/skip bookkeeping (module memory, 30-min grace).
 *
 * The dependencies below are all leaf modules (no imports back into auth), so
 * there is no cycle. Storages are injectable for the node vitest environment.
 */
export function clearUserSessionState(
  sessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.sessionStorage,
  subjectStorage?: SubjectIdStorage,
): void {
  clearFlowStateFromStorage(sessionStorage);
  clearStoredSubjectId(subjectStorage);
  resetScaleCompletion();
}
