import { EXPERIMENT_PREFERENCES_KEY } from '../experiment/settings';
import { clearFlowStateFromStorage } from '../pages/home/effectEvaluationFlow';
import { clearStoredSubjectId, type SubjectIdStorage } from '../storage/currentSubject';

/** Clear the subject binding, recording confirmation and saved run when changing users. */
export function clearUserSessionState(
  sessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.sessionStorage,
  subjectStorage?: SubjectIdStorage,
): void {
  clearFlowStateFromStorage(sessionStorage);
  sessionStorage.removeItem(EXPERIMENT_PREFERENCES_KEY);
  clearStoredSubjectId(subjectStorage);
}
