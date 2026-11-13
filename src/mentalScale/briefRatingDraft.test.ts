import { expect, it } from 'vitest';
import { clearBriefDraft, readBriefDraft, writeBriefDraft } from './briefRatingDraft';

function makeStore() {
  const rows = new Map<string, string>();
  return {
    rows,
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => void rows.set(key, value),
    removeItem: (key: string) => void rows.delete(key),
  };
}

it('only restores answers for the same run and phase, and clears only the submitted draft', () => {
  const store = makeStore();
  writeBriefDraft(store, 'run1', 'baseline', { valence: 2 });
  expect(readBriefDraft(store, 'run1', 'post')).toEqual({});
  expect(readBriefDraft(store, 'run2', 'baseline')).toEqual({});
  writeBriefDraft(store, 'run1', 'post', { dominance: 9 });
  clearBriefDraft(store, 'run2', 'baseline');
  expect(readBriefDraft(store, 'run1', 'baseline')).toEqual({ valence: 2 });
  clearBriefDraft(store, 'run1', 'baseline');
  expect(readBriefDraft(store, 'run1', 'baseline')).toEqual({});
  expect(readBriefDraft(store, 'run1', 'post')).toEqual({ dominance: 9 });
});

it('drops corrupt values without filling unanswered dimensions', () => {
  const store = makeStore();
  writeBriefDraft(store, 'run', 'baseline', { valence: 10, arousal: 1.2, dominance: 1 });
  expect(readBriefDraft(store, 'run', 'baseline')).toEqual({ dominance: 1 });
});
