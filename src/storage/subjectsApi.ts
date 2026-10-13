import { invoke } from '@tauri-apps/api/core';

export type Subject = {
  id: string;
  userId: string;
  subjectCode: string;
  nameAlias: string | null;
  gender: string | null;
  birthYear: number | null;
  handedness: string | null;
  capSize: string | null;
  clinicalGroup: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SaveSubjectInput = {
  id?: string | null;
  userId: string;
  subjectCode: string;
  nameAlias?: string | null;
  gender?: string | null;
  birthYear?: number | null;
  handedness?: string | null;
  capSize?: string | null;
  clinicalGroup?: string | null;
  notes?: string | null;
};

export function listSubjects(userId: string): Promise<Subject[]> {
  return invoke<Subject[]>('list_subjects', { userId });
}

export function saveSubject(input: SaveSubjectInput): Promise<Subject> {
  return invoke<Subject>('save_subject', { input });
}

export function deleteSubject(id: string, userId: string): Promise<Subject>;
export function deleteSubject(input: { id: string; userId: string }): Promise<Subject>;
export function deleteSubject(
  idOrInput: string | { id: string; userId: string },
  maybeUserId?: string,
): Promise<Subject> {
  const input =
    typeof idOrInput === 'string' ? { id: idOrInput, userId: maybeUserId ?? '' } : idOrInput;
  return invoke<Subject>('delete_subject', { input, id: input.id, userId: input.userId });
}
