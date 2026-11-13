import { samDimensionKeys, type SamScore } from './instruments/sam';
import type { ScalePhase } from './scaleRecordsApi';

export type BriefAnswers = Partial<SamScore>;

// A bounded slot per phase. A different run never restores the previous answers.
const draftKey = (phase: ScalePhase) => `effect-evaluation.vad.draft.${phase}`;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readBriefDraft(storage: Store, runId: string, phase: ScalePhase): BriefAnswers {
  try {
    const draft = JSON.parse(storage.getItem(draftKey(phase)) ?? 'null');
    if (!draft || draft.runId !== runId) return {};
    const result: BriefAnswers = {};
    for (const key of samDimensionKeys) {
      const value = draft.answers?.[key];
      if (Number.isInteger(value) && value >= 1 && value <= 9) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

export function writeBriefDraft(
  storage: Store,
  runId: string,
  phase: ScalePhase,
  answers: BriefAnswers,
) {
  try {
    storage.setItem(draftKey(phase), JSON.stringify({ runId, answers }));
  } catch {
    // A full session store does not prevent answering or submitting the form.
  }
}

export function clearBriefDraft(storage: Store, runId: string, phase: ScalePhase) {
  try {
    const key = draftKey(phase);
    if (JSON.parse(storage.getItem(key) ?? 'null')?.runId === runId) storage.removeItem(key);
  } catch {
    // The answer record has already been saved.
  }
}
