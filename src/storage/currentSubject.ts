/**
 * Canonical subject memory shared by every flow that records data against
 * a subject: the paradigm setup panel writes it before acquisition, and the
 * effect-evaluation loop plus the gate persistence leg read it back, so scale
 * records stop being written without a subject binding once an operator has
 * set one.
 *
 * Best-effort by design (E-Prime StartupInfo style): storage may be
 * unavailable, in which case reads degrade to empty/null and writes are silently
 * dropped.
 */

export const SUBJECT_ID_STORAGE_KEY = 'paradigm.subjectId';
export const SUBJECT_METADATA_STORAGE_KEY = 'paradigm.subjectMetadata';

export type SubjectIdStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type CurrentSubjectMetadata = {
  id?: string | null;
  subjectCode: string;
  nameAlias?: string | null;
  gender?: string | null;
  birthYear?: number | null;
  handedness?: string | null;
  capSize?: string | null;
  clinicalGroup?: string | null;
  notes?: string | null;
};

/**
 * Normalizes a subject code: trims whitespace and returns an empty string if blank.
 */
export function normalizeSubjectCode(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return value.trim();
}

function defaultStorage(): SubjectIdStorage | null {
  try {
    return window.localStorage;
  } catch {
    // Non-browser environment (tests) or disabled storage.
    return null;
  }
}

export function readStoredSubjectId(storage: SubjectIdStorage | null = defaultStorage()): string {
  if (!storage) {
    return '';
  }

  try {
    const raw = storage.getItem(SUBJECT_ID_STORAGE_KEY);
    if (raw && raw.trim().length > 0) {
      return normalizeSubjectCode(raw);
    }

    // Fallback: inspect metadata cache if stored subject ID is blank
    const metaRaw = storage.getItem(SUBJECT_METADATA_STORAGE_KEY);
    if (metaRaw) {
      const parsed = JSON.parse(metaRaw) as CurrentSubjectMetadata;
      if (parsed && typeof parsed.subjectCode === 'string') {
        return normalizeSubjectCode(parsed.subjectCode);
      }
    }

    return '';
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

  const normalized = normalizeSubjectCode(value);
  try {
    storage.setItem(SUBJECT_ID_STORAGE_KEY, normalized);

    // Keep metadata subjectCode in sync if cached
    const metaRaw = storage.getItem(SUBJECT_METADATA_STORAGE_KEY);
    if (metaRaw) {
      const parsed = JSON.parse(metaRaw) as CurrentSubjectMetadata;
      if (parsed && typeof parsed === 'object') {
        if (!normalized) {
          storage.removeItem(SUBJECT_METADATA_STORAGE_KEY);
        } else if (parsed.subjectCode !== normalized) {
          parsed.subjectCode = normalized;
          storage.setItem(SUBJECT_METADATA_STORAGE_KEY, JSON.stringify(parsed));
        }
      }
    }
  } catch {
    // Storage may be unavailable; persistence is best-effort and silent.
  }
}

export function readStoredSubjectMetadata(
  storage: SubjectIdStorage | null = defaultStorage(),
): CurrentSubjectMetadata | null {
  if (!storage) {
    return null;
  }

  try {
    const metaRaw = storage.getItem(SUBJECT_METADATA_STORAGE_KEY);
    if (metaRaw) {
      const parsed = JSON.parse(metaRaw) as CurrentSubjectMetadata;
      if (parsed && typeof parsed === 'object' && parsed.subjectCode) {
        return {
          ...parsed,
          subjectCode: normalizeSubjectCode(parsed.subjectCode),
        };
      }
    }

    // Fallback to minimal metadata if only subject ID was recorded
    const storedId = readStoredSubjectId(storage);
    if (storedId) {
      return { subjectCode: storedId };
    }

    return null;
  } catch {
    return null;
  }
}

export function writeStoredSubjectMetadata(
  metadata: CurrentSubjectMetadata | null,
  storage: SubjectIdStorage | null = defaultStorage(),
): void {
  if (!storage) {
    return;
  }

  try {
    if (!metadata) {
      storage.removeItem(SUBJECT_METADATA_STORAGE_KEY);
      return;
    }

    const normalizedCode = normalizeSubjectCode(metadata.subjectCode);
    const cleanedMetadata: CurrentSubjectMetadata = {
      ...metadata,
      subjectCode: normalizedCode,
    };

    storage.setItem(SUBJECT_METADATA_STORAGE_KEY, JSON.stringify(cleanedMetadata));
    storage.setItem(SUBJECT_ID_STORAGE_KEY, normalizedCode);
  } catch {
    // Storage may be unavailable; persistence is best-effort and silent.
  }
}

/** Clears the subject memory (sign-out hygiene): the next user must not
 * inherit the previous one's subject binding. Best-effort like the writes. */
export function clearStoredSubjectId(storage: SubjectIdStorage | null = defaultStorage()): void {
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(SUBJECT_ID_STORAGE_KEY);
    storage.removeItem(SUBJECT_METADATA_STORAGE_KEY);
  } catch {
    // Storage may be unavailable; clearing is best-effort and silent.
  }
}

export function clearStoredSubjectMetadata(
  storage: SubjectIdStorage | null = defaultStorage(),
): void {
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(SUBJECT_METADATA_STORAGE_KEY);
  } catch {
    // Storage may be unavailable; clearing is best-effort and silent.
  }
}
