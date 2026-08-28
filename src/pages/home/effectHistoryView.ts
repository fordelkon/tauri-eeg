import type { EffectHistoryEntryView } from '../../mentalScale/scaleRecordsApi';
import { EFFECT_EMOTION_OPTIONS, formatImprovementRate, labelForCondition } from './effectEvaluationFlow';

/**
 * Pure view-model for the history review tab: subject grouping, filtering,
 * and display formatting. Free of React/Tauri/DOM access so the list rules
 * stay unit-testable in the node vitest environment.
 */

/** Completed runs grouped per subject, ready for the collapsible sections. */
export type HistorySubjectGroup = {
  /** Subject id; '' collects runs that were saved without a binding. */
  subjectId: string;
  /** Newest run first. */
  entries: EffectHistoryEntryView[];
};

const UNBOUND_SUBJECT_KEY = '';

// RFC3339 stamps share one offset (the backend writes UTC), so lexicographic
// order equals chronological order.
function compareRuns(
  a: EffectHistoryEntryView,
  b: EffectHistoryEntryView,
): number {
  if (a.postCreatedAt > b.postCreatedAt) {
    return -1;
  }
  if (a.postCreatedAt < b.postCreatedAt) {
    return 1;
  }
  return 0;
}

/**
 * Groups completed runs per subject. Subjects sort by their newest run
 * (newest first); the unbound group sorts last so named subjects lead.
 */
export function groupHistoryBySubject(
  entries: readonly EffectHistoryEntryView[],
): HistorySubjectGroup[] {
  const bySubject = new Map<string, EffectHistoryEntryView[]>();

  for (const entry of entries) {
    const key = entry.subjectId.trim().length > 0 ? entry.subjectId : UNBOUND_SUBJECT_KEY;
    const bucket = bySubject.get(key);

    if (bucket) {
      bucket.push(entry);
    } else {
      bySubject.set(key, [entry]);
    }
  }

  const groups = [...bySubject.entries()].map(([subjectId, groupEntries]) => ({
    subjectId,
    entries: [...groupEntries].sort(compareRuns),
  }));

  const newestOf = (group: HistorySubjectGroup) => group.entries[0]?.postCreatedAt ?? '';
  const unbound = groups.find((group) => group.subjectId === UNBOUND_SUBJECT_KEY);
  const bound = groups
    .filter((group) => group.subjectId !== UNBOUND_SUBJECT_KEY)
    .sort((a, b) => {
      if (newestOf(a) > newestOf(b)) {
        return -1;
      }
      if (newestOf(a) < newestOf(b)) {
        return 1;
      }
      return 0;
    });

  return unbound ? [...bound, unbound] : bound;
}

/** Case-insensitive substring match on the subject id; blank query keeps all. */
export function filterHistoryEntries(
  entries: readonly EffectHistoryEntryView[],
  query: string,
): EffectHistoryEntryView[] {
  const needle = query.trim().toLowerCase();

  if (needle.length === 0) {
    return [...entries];
  }

  return entries.filter((entry) => entry.subjectId.toLowerCase().includes(needle));
}

export function labelForEmotion(emotion: string | null): string {
  if (!emotion) {
    return '—';
  }

  return EFFECT_EMOTION_OPTIONS.find((option) => option.value === emotion)?.label ?? emotion;
}

/**
 * Condition label for the history rows (R7, feedback-003 P2-1): operators
 * must be able to tell natural-recovery, regulation, and pre-R6 legacy runs
 * apart when checking "两条件各完成一次"; legacy null rows keep their explicit
 * legacy annotation instead of blending into the regulation condition.
 */
export function labelForHistoryCondition(condition: string | null): string {
  return labelForCondition(condition);
}

export function formatMeanImprovementRate(rate: number | null): string {
  return rate === null ? '—' : formatImprovementRate(rate);
}

export type HistoryOutcome = '达标' | '未达标' | '无法判定';

export function outcomeForEntry(
  entry: Pick<EffectHistoryEntryView, 'meanImprovementRate' | 'meetsThreshold'>,
): HistoryOutcome {
  if (entry.meanImprovementRate === null) {
    return '无法判定';
  }

  return entry.meetsThreshold ? '达标' : '未达标';
}

/** Local-time `YYYY-MM-DD HH:mm`; unparsable input echoes back unchanged. */
export function formatRunTimestamp(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${
    pad(date.getHours())}:${pad(date.getMinutes())}`;
}
