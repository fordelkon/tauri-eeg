/**
 * Canonical subject-id memory shared by every flow that records data against
 * a subject: the paradigm setup panel writes it before acquisition, and the
 * effect-evaluation loop plus the gate persistence leg read it back, so scale
 * records stop being written without a subject binding once an operator has
 * set one.
 *
 * Best-effort by design (E-Prime StartupInfo style): storage may be
 * unavailable, in which case reads degrade to empty and writes are silently
 * dropped.
 */

export const SUBJECT_ID_STORAGE_KEY = 'paradigm.subjectId';

export type SubjectIdStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): SubjectIdStorage | null {
  try {
    return window.localStorage;
  } catch {
    // Non-browser environment (tests) or disabled storage.
    return null;
  }
}

export function readStoredSubjectId(
  storage: SubjectIdStorage | null = defaultStorage(),
): string {
  if (!storage) {
    return '';
  }

  try {
    return storage.getItem(SUBJECT_ID_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeStoredSubjectId(
  value: string,
  storage: SubjectIdStorage | null = defaultStorage(),
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(SUBJECT_ID_STORAGE_KEY, value);
  } catch {
    // Storage may be unavailable; persistence is best-effort and silent.
  }
}
