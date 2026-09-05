import type { BatteryDimensionScores } from './instruments/battery';
import { staiPanasBatteryDefinition } from './instruments/battery';
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

// PHQ-4 gate items (doc scale-instruments.md §2.1): items 1-2 form the
// depression subscale (→ mood), items 3-4 the anxiety subscale; item 4 is the
// core worry item (→ worry).
const questionDimensionMap: Record<string, MentalScaleDimensionKey> = {
  'phq4_1': 'mood',
  'phq4_2': 'mood',
  'phq4_3': 'anxiety',
  'phq4_4': 'worry',
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

/** Maps a score onto the 0-100 severity percent the radar displays. */
function rangePercent(value: number, min: number, max: number): number {
  return ((value - min) / (max - min)) * 100;
}

/**
 * Radar/status mirror for the STAI-S + PANAS battery (the evaluation wizard's
 * ②/④ instrument, doc scale-instruments.md §3.1). Battery engine scores are
 * lower=better (anxiety 20-80, mood/energy 1-5); the radar displays 0-100
 * severity percent (higher = more negative state), matching the gate's
 * answer/max scaling. `worry` is not measured by the battery and keeps the
 * neutral placeholder, exactly like unmeasured gate dimensions.
 */
export function buildBatteryMentalScaleStatus(
  scores: BatteryDimensionScores,
  updatedAt = Date.now(),
): MentalScaleStatus {
  const severity: Partial<Record<MentalScaleDimensionKey, number>> = {
    anxiety: rangePercent(scores.anxiety, 20, 80),
    mood: rangePercent(scores.mood, 1, 5),
    energy: rangePercent(scores.energy, 1, 5),
  };

  return {
    dimensions: mentalScaleDimensions.map((dimension) => {
      const value = severity[dimension.key];

      return {
        ...dimension,
        value: value === undefined ? 50 : Math.round(value),
      };
    }),
    lastScaleTitle: staiPanasBatteryDefinition.title,
    updatedAt,
  };
}
