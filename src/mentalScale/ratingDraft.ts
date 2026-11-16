import type { ScalePhase } from './scaleRecordsApi';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Each instrument has one bounded slot per phase, tagged with the current run. */
export function createRatingDraft<Key extends string>(
  prefix: string,
  itemKeys: readonly Key[],
  isRating: (value: unknown) => value is number,
) {
  type Answers = Partial<Record<Key, number>>;
  const draftKey = (phase: ScalePhase) => `${prefix}.${phase}`;
  return {
    read(storage: Store, runId: string, phase: ScalePhase): Answers {
      try {
        const draft = JSON.parse(storage.getItem(draftKey(phase)) ?? 'null');
        const result: Answers = {};
        if (draft?.runId !== runId) return result;
        for (const key of itemKeys) {
          const value: unknown = draft.answers?.[key];
          if (isRating(value)) result[key] = value;
        }
        return result;
      } catch {
        return {};
      }
    },
    write(storage: Store, runId: string, phase: ScalePhase, answers: Answers): void {
      try {
        storage.setItem(draftKey(phase), JSON.stringify({ runId, answers }));
      } catch {
        // A full session store does not prevent answering or submitting.
      }
    },
    clear(storage: Store, runId: string, phase: ScalePhase): void {
      try {
        const key = draftKey(phase);
        if (JSON.parse(storage.getItem(key) ?? 'null')?.runId === runId) storage.removeItem(key);
      } catch {
        // The submitted answers have already been saved.
      }
    },
  };
}
