export type MentalScalePath = '/video-regulation' | '/game-regulation' | '/music-regulation';

export type MentalScaleAnswerValue = 0 | 1 | 2 | 3;

export type MentalScaleQuestion = {
  id: string;
  prompt: string;
};

export type MentalScaleDefinition = {
  path: MentalScalePath;
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

export const mentalScaleAnswerOptions: Array<{ value: MentalScaleAnswerValue; label: string }> = [
  { value: 0, label: '没有' },
  { value: 1, label: '轻微' },
  { value: 2, label: '中等' },
  { value: 3, label: '强烈' },
];

const stateCheck: Omit<MentalScaleDefinition, 'path'> = {
  scaleId: 'momentary_checkin_2_v1',
  title: '此刻感受',
  subtitle: '请按此刻的实际感受，分别选择强度。',
  questions: [
    { id: 'tension_now', prompt: '此刻，你感到多大程度的紧绷？' },
    { id: 'unpleasant_now', prompt: '此刻，你感到多大程度的不愉快？' },
  ],
};

export const mentalScaleDefinitions: Record<MentalScalePath, MentalScaleDefinition> = {
  '/video-regulation': { path: '/video-regulation', ...stateCheck },
  '/game-regulation': { path: '/game-regulation', ...stateCheck },
  '/music-regulation': { path: '/music-regulation', ...stateCheck },
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
