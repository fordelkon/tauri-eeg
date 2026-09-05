import {
  PHQ4_INSTRUCTION,
  PHQ4_SCALE_ID,
  PHQ4_SCREENING_NOTE,
  phq4Items,
} from './instruments/phq4';

export type MentalScalePath = '/video-regulation' | '/game-regulation' | '/music-regulation';

export type MentalScaleAnswerValue = 0 | 1 | 2 | 3;

export type MentalScaleQuestion = {
  id: string;
  prompt: string;
};

export type MentalScaleDefinition = {
  path: MentalScalePath;
  /**
   * scale_records scale_id (doc scale-instruments.md §3.3 naming: no longer
   * the route path — the screening instrument is one shared PHQ-4).
   */
  scaleId: string;
  title: string;
  subtitle: string;
  questions: MentalScaleQuestion[];
  /**
   * Neutral completion note shown when the screening total reaches the
   * literature cutoff; informational only, never a diagnosis (doc §2.1).
   */
  screening?: { threshold: number; message: string };
};

export type MentalScaleAnswers = Record<string, MentalScaleAnswerValue | undefined>;

/** PHQ-4 frequency anchors for values 0-3 (doc scale-instruments.md §2.1). */
export const mentalScaleAnswerOptions: Array<{ value: MentalScaleAnswerValue; label: string }> = [
  { value: 0, label: '完全不会' },
  { value: 1, label: '好几天' },
  { value: 2, label: '一半以上的天数' },
  { value: 3, label: '几乎每天' },
];

/**
 * Shared gate instrument (doc scale-instruments.md §2.1): the public-domain
 * PHQ-4 replaces the three per-method 3-item scales, which mixed a trait-style
 * "recent week" recall window into a gate measurement and changed the items
 * per regulation arm. Every regulation path now screens with the same 4 items;
 * the per-path identity stays (completion/skip bookkeeping is per route).
 */
const phq4GateContent: Omit<MentalScaleDefinition, 'path'> = {
  scaleId: PHQ4_SCALE_ID,
  title: '心理健康筛查（PHQ-4）',
  subtitle: PHQ4_INSTRUCTION,
  questions: phq4Items.map((item) => ({ id: item.id, prompt: item.textZh })),
  screening: PHQ4_SCREENING_NOTE,
};

export const mentalScaleDefinitions: Record<MentalScalePath, MentalScaleDefinition> = {
  '/video-regulation': { path: '/video-regulation', ...phq4GateContent },
  '/game-regulation': { path: '/game-regulation', ...phq4GateContent },
  '/music-regulation': { path: '/music-regulation', ...phq4GateContent },
};

export function getMentalScaleForPath(path: string): MentalScaleDefinition | null {
  if (path in mentalScaleDefinitions) {
    return mentalScaleDefinitions[path as MentalScalePath];
  }

  return null;
}

export function isMentalScaleComplete(
  scale: MentalScaleDefinition,
  answers: MentalScaleAnswers,
): boolean {
  return scale.questions.every((question) => answers[question.id] !== undefined);
}
