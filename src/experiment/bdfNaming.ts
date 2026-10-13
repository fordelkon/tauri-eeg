/**
 * BIDS-compliant BDF standard filename generator.
 * Format: sub-<subjectId>_ses-<session>_task-<task>.bdf
 */

export type StandardBdfOptions = {
  subjectId?: string | null;
  task?: string | null;
  session?: string | number | null;
};

export function buildStandardBdfFileName(options: StandardBdfOptions = {}): string {
  const rawSubject = options.subjectId?.trim() || '';
  let subTag = 'sub-001';

  if (rawSubject) {
    const cleanSub = rawSubject.replace(/[^\w-]/g, '');
    if (/^sub[-_]?/i.test(cleanSub)) {
      subTag = cleanSub.replace(/^sub[-_]?/i, 'sub-');
    } else {
      subTag = `sub-${cleanSub}`;
    }
  }

  const sessionNum = options.session ?? 1;
  const sesTag =
    typeof sessionNum === 'number'
      ? `ses-${String(sessionNum).padStart(2, '0')}`
      : String(sessionNum).startsWith('ses-')
        ? String(sessionNum)
        : `ses-${sessionNum}`;

  const rawTask = options.task?.trim() || 'effect';
  const taskTag = rawTask.startsWith('task-')
    ? rawTask
    : `task-${rawTask === 'paradigm' ? 'paradigm' : rawTask === 'rest' ? 'rest' : 'effect'}`;

  return `${subTag}_${sesTag}_${taskTag}.bdf`;
}
