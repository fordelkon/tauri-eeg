import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteSubject,
  listSubjects,
  saveSubject,
  type SaveSubjectInput,
  type Subject,
} from './subjectsApi';
import {
  clearStoredSubjectId,
  clearStoredSubjectMetadata,
  normalizeSubjectCode,
  readStoredSubjectId,
  readStoredSubjectMetadata,
  SUBJECT_ID_STORAGE_KEY,
  SUBJECT_METADATA_STORAGE_KEY,
  writeStoredSubjectId,
  writeStoredSubjectMetadata,
  type CurrentSubjectMetadata,
  type SubjectIdStorage,
} from './currentSubject';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

function createMemoryStorage(): SubjectIdStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

describe('subjectsApi', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists subjects for a given user', async () => {
    const mockSubjects: Subject[] = [
      {
        id: 'subj-1',
        userId: 'user-alice',
        subjectCode: 'SUBJ-001',
        nameAlias: 'Alice Sub',
        gender: 'female',
        birthYear: 1996,
        handedness: 'right',
        capSize: 'M',
        clinicalGroup: 'control',
        notes: 'First participant',
        createdAt: '2026-06-01T10:00:00Z',
        updatedAt: '2026-06-01T10:00:00Z',
      },
    ];

    vi.mocked(invoke).mockResolvedValueOnce(mockSubjects);

    const result = await listSubjects('user-alice');
    expect(invoke).toHaveBeenCalledWith('list_subjects', { userId: 'user-alice' });
    expect(result).toEqual(mockSubjects);
  });

  it('saves subject with camelCase input payload', async () => {
    const input: SaveSubjectInput = {
      userId: 'user-alice',
      subjectCode: 'SUBJ-002',
      nameAlias: 'Bob Sub',
      gender: 'male',
      birthYear: 1992,
      handedness: 'right',
      capSize: 'L',
      clinicalGroup: 'experimental',
      notes: 'Notes here',
    };

    const savedResult: Subject = {
      ...input,
      id: input.id ?? 'subj-new-id',
      nameAlias: input.nameAlias ?? null,
      gender: input.gender ?? null,
      birthYear: input.birthYear ?? null,
      handedness: input.handedness ?? null,
      capSize: input.capSize ?? null,
      clinicalGroup: input.clinicalGroup ?? null,
      notes: input.notes ?? null,
      createdAt: '2026-06-01T12:00:00Z',
      updatedAt: '2026-06-01T12:00:00Z',
    };

    vi.mocked(invoke).mockResolvedValueOnce(savedResult);

    const result = await saveSubject(input);
    expect(invoke).toHaveBeenCalledWith('save_subject', { input });
    expect(result).toEqual(savedResult);
  });

  it('deletes a subject with id and userId arguments', async () => {
    const deletedSubject: Subject = {
      id: 'subj-1',
      userId: 'user-alice',
      subjectCode: 'SUBJ-001',
      nameAlias: null,
      gender: null,
      birthYear: null,
      handedness: null,
      capSize: null,
      clinicalGroup: null,
      notes: null,
      createdAt: '2026-06-01T10:00:00Z',
      updatedAt: '2026-06-01T10:00:00Z',
    };

    vi.mocked(invoke).mockResolvedValueOnce(deletedSubject);

    const result = await deleteSubject('subj-1', 'user-alice');
    expect(invoke).toHaveBeenCalledWith('delete_subject', {
      input: { id: 'subj-1', userId: 'user-alice' },
      id: 'subj-1',
      userId: 'user-alice',
    });
    expect(result).toEqual(deletedSubject);
  });

  it('deletes a subject with object input argument', async () => {
    const deletedSubject: Subject = {
      id: 'subj-2',
      userId: 'user-bob',
      subjectCode: 'SUBJ-002',
      nameAlias: null,
      gender: null,
      birthYear: null,
      handedness: null,
      capSize: null,
      clinicalGroup: null,
      notes: null,
      createdAt: '2026-06-01T10:00:00Z',
      updatedAt: '2026-06-01T10:00:00Z',
    };

    vi.mocked(invoke).mockResolvedValueOnce(deletedSubject);

    const result = await deleteSubject({ id: 'subj-2', userId: 'user-bob' });
    expect(invoke).toHaveBeenCalledWith('delete_subject', {
      input: { id: 'subj-2', userId: 'user-bob' },
      id: 'subj-2',
      userId: 'user-bob',
    });
    expect(result).toEqual(deletedSubject);
  });
});

describe('currentSubject storage and metadata', () => {
  it('normalizes subject codes correctly', () => {
    expect(normalizeSubjectCode('  SUBJ-123  ')).toBe('SUBJ-123');
    expect(normalizeSubjectCode('')).toBe('');
    expect(normalizeSubjectCode(null)).toBe('');
    expect(normalizeSubjectCode(undefined)).toBe('');
    expect(normalizeSubjectCode('   ')).toBe('');
  });

  it('maintains backward-compatible readStoredSubjectId and writeStoredSubjectId', () => {
    const storage = createMemoryStorage();

    expect(readStoredSubjectId(storage)).toBe('');

    writeStoredSubjectId('  SUBJ-007  ', storage);
    expect(readStoredSubjectId(storage)).toBe('SUBJ-007');
    expect(storage.getItem(SUBJECT_ID_STORAGE_KEY)).toBe('SUBJ-007');
  });

  it('stores and retrieves subject metadata while keeping subject ID in sync', () => {
    const storage = createMemoryStorage();
    const meta: CurrentSubjectMetadata = {
      id: 's-id-10',
      subjectCode: '  SUBJ-ALPHA  ',
      nameAlias: 'Alpha Subject',
      gender: 'female',
      birthYear: 1995,
      capSize: 'M',
    };

    writeStoredSubjectMetadata(meta, storage);

    // Subject code is normalized in both ID key and metadata key
    expect(readStoredSubjectId(storage)).toBe('SUBJ-ALPHA');
    expect(storage.getItem(SUBJECT_ID_STORAGE_KEY)).toBe('SUBJ-ALPHA');

    const retrieved = readStoredSubjectMetadata(storage);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.subjectCode).toBe('SUBJ-ALPHA');
    expect(retrieved?.nameAlias).toBe('Alpha Subject');
    expect(retrieved?.gender).toBe('female');
    expect(retrieved?.birthYear).toBe(1995);
    expect(retrieved?.capSize).toBe('M');
  });

  it('synchronizes cached metadata when writeStoredSubjectId updates code', () => {
    const storage = createMemoryStorage();
    writeStoredSubjectMetadata(
      {
        subjectCode: 'SUBJ-OLD',
        nameAlias: 'Old Alias',
      },
      storage,
    );

    expect(readStoredSubjectMetadata(storage)?.subjectCode).toBe('SUBJ-OLD');

    writeStoredSubjectId('SUBJ-NEW', storage);
    expect(readStoredSubjectId(storage)).toBe('SUBJ-NEW');
    expect(readStoredSubjectMetadata(storage)?.subjectCode).toBe('SUBJ-NEW');
  });

  it('clears metadata and subject ID on clearStoredSubjectId', () => {
    const storage = createMemoryStorage();
    writeStoredSubjectMetadata(
      {
        subjectCode: 'SUBJ-TEST',
        gender: 'male',
      },
      storage,
    );

    expect(readStoredSubjectId(storage)).toBe('SUBJ-TEST');
    expect(readStoredSubjectMetadata(storage)).not.toBeNull();

    clearStoredSubjectId(storage);

    expect(readStoredSubjectId(storage)).toBe('');
    expect(readStoredSubjectMetadata(storage)).toBeNull();
    expect(storage.getItem(SUBJECT_ID_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(SUBJECT_METADATA_STORAGE_KEY)).toBeNull();
  });

  it('allows clearing metadata specifically with clearStoredSubjectMetadata', () => {
    const storage = createMemoryStorage();
    writeStoredSubjectMetadata({ subjectCode: 'SUBJ-SPEC' }, storage);

    clearStoredSubjectMetadata(storage);
    expect(storage.getItem(SUBJECT_METADATA_STORAGE_KEY)).toBeNull();
    // Falls back to ID if subject ID remains
    expect(readStoredSubjectId(storage)).toBe('SUBJ-SPEC');
    expect(readStoredSubjectMetadata(storage)).toEqual({ subjectCode: 'SUBJ-SPEC' });
  });

  it('degrades silently when storage is null or throws', () => {
    expect(readStoredSubjectId(null)).toBe('');
    expect(readStoredSubjectMetadata(null)).toBeNull();
    expect(() => writeStoredSubjectId('CODE', null)).not.toThrow();
    expect(() => writeStoredSubjectMetadata({ subjectCode: 'CODE' }, null)).not.toThrow();
    expect(() => clearStoredSubjectId(null)).not.toThrow();

    const throwingStorage: SubjectIdStorage = {
      getItem: () => {
        throw new Error('Access denied');
      },
      setItem: () => {
        throw new Error('Quota exceeded');
      },
      removeItem: () => {
        throw new Error('Failure');
      },
    };

    expect(readStoredSubjectId(throwingStorage)).toBe('');
    expect(readStoredSubjectMetadata(throwingStorage)).toBeNull();
    expect(() => writeStoredSubjectId('CODE', throwingStorage)).not.toThrow();
    expect(() =>
      writeStoredSubjectMetadata({ subjectCode: 'CODE' }, throwingStorage),
    ).not.toThrow();
    expect(() => clearStoredSubjectId(throwingStorage)).not.toThrow();
  });
});
