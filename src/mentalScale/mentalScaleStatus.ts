import type {
  MentalScaleAnswers,
  MentalScaleDefinition,
  MentalScaleQuestion,
} from './mentalScaleGate';

export type MentalScaleDimensionKey =
  | 'anxiety'
  | 'worry'
  | 'mood'
  | 'energy';

export type MentalScaleDimensionDefinition = {
  key: MentalScaleDimensionKey;
  label: string;
  description: string;
};

export type MentalScaleDimensionValue = MentalScaleDimensionDefinition & {
  value: number;
};

export type MentalScaleStatus = {
  dimensions: MentalScaleDimensionValue[];
  lastScaleTitle: string;
  updatedAt: number | null;
};

export const mentalScaleDimensions: MentalScaleDimensionDefinition[] = [
  { key: 'anxiety', label: 'Anxiety', description: 'Tension, unease, and difficulty relaxing' },
  { key: 'worry', label: 'Worry', description: 'Persistent or difficult-to-control worry' },
  { key: 'mood', label: 'Mood', description: 'Low mood, hopelessness, or reduced interest' },
  { key: 'energy', label: 'Energy', description: 'Fatigue, sleep disruption, and low activation' },
];

export const defaultMentalScaleStatus: MentalScaleStatus = {
  dimensions: mentalScaleDimensions.map((dimension) => ({
    ...dimension,
    value: 50,
  })),
  lastScaleTitle: 'Average Baseline',
  updatedAt: null,
};

type MentalScaleListener = () => void;

const questionDimensionMap: Record<string, MentalScaleDimensionKey> = {
  'video-anxiety-tense': 'anxiety',
  'video-anxiety-worry': 'worry',
  'video-depression-interest': 'mood',
  'game-anxiety-irritable': 'anxiety',
  'game-depression-energy': 'energy',
  'game-depression-self-blame': 'mood',
  'music-depression-low': 'mood',
  'music-depression-sleep': 'energy',
  'music-anxiety-relax': 'anxiety',
};

let currentStatus: MentalScaleStatus = defaultMentalScaleStatus;
const listeners = new Set<MentalScaleListener>();

export function getMentalScaleStatusSnapshot(): MentalScaleStatus {
  return currentStatus;
}

export function subscribeMentalScaleStatus(listener: MentalScaleListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function updateMentalScaleStatus(status: MentalScaleStatus): void {
  currentStatus = status;
  for (const listener of listeners) {
    listener();
  }
}

/** Groups each answered question's percent score by its dimension. */
function collectDimensionAnswers(
  scale: MentalScaleDefinition,
  answers: MentalScaleAnswers,
): Map<MentalScaleDimensionKey, number[]> {
  const dimensionValues = new Map<MentalScaleDimensionKey, number[]>();

  for (const question of scale.questions) {
    const dimensionKey = getQuestionDimensionKey(question);
    const answer = answers[question.id];

    if (!dimensionKey || answer === undefined) {
      continue;
    }

    const values = dimensionValues.get(dimensionKey) ?? [];
    values.push(Math.round((answer / 3) * 100));
    dimensionValues.set(dimensionKey, values);
  }

  return dimensionValues;
}

/**
 * Dimensions with at least one answered question, in canonical order. The
 * persistence layer stores this marker alongside the scores so the effect
 * computation can exclude never-measured placeholder dimensions (F1).
 */
export function measuredDimensionKeys(
  scale: MentalScaleDefinition,
  answers: MentalScaleAnswers,
): MentalScaleDimensionKey[] {
  const measured = collectDimensionAnswers(scale, answers);

  return mentalScaleDimensions
    .map((dimension) => dimension.key)
    .filter((key) => measured.has(key));
}

export function buildMentalScaleStatus(
  scale: MentalScaleDefinition,
  answers: MentalScaleAnswers,
  updatedAt = Date.now(),
): MentalScaleStatus {
  const dimensionValues = collectDimensionAnswers(scale, answers);

  return {
    dimensions: mentalScaleDimensions.map((dimension) => {
      const values = dimensionValues.get(dimension.key);
      const value = values && values.length > 0
        ? Math.round(values.reduce((total, item) => total + item, 0) / values.length)
        : 50;

      return {
        ...dimension,
        value,
      };
    }),
    lastScaleTitle: scale.title,
    updatedAt,
  };
}

function getQuestionDimensionKey(question: MentalScaleQuestion): MentalScaleDimensionKey | null {
  return questionDimensionMap[question.id] ?? null;
}
