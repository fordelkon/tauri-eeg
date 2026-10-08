import type { ParadigmEmotion, ParadigmSessionKind, ParadigmVideoLibrary } from './types';

/**
 * Static session-kind metadata and small pure helpers for the paradigm setup
 * panel. Kept free of React so the copy tables stay inspectable next to the
 * panel's option lists.
 */

export const sessionKindDescriptions: Record<ParadigmSessionKind, string> = {
  personal_calibration: '只采集平静基准,用于训练被试个性化情绪模型。',
  held_out_generation: '依次诱发焦虑、抑郁、恐惧三类情绪,按流程采集评价。',
};

export const sessionKindShortLabels: Record<ParadigmSessionKind, string> = {
  personal_calibration: '个人校准',
  held_out_generation: '独立诱发调控',
};

export const sessionKinds: readonly ParadigmSessionKind[] = [
  'personal_calibration',
  'held_out_generation',
];

export const libraryClassKeys: Record<ParadigmEmotion, keyof Pick<
  ParadigmVideoLibrary,
  'anxiety' | 'calm' | 'depression' | 'fear'
>> = {
  anxiety: 'anxiety',
  calm: 'calm',
  depression: 'depression',
  fear: 'fear',
};

export function toLibraryErrorMessage(error: unknown) {
  return typeof error === 'string' ? error : error instanceof Error ? error.message : 'Failed to load paradigm video library.';
}

/** Default run id, local time: run-YYYYMMDD-HHmm (e.g. run-20260823-1945). */
export function defaultSessionRunId(now: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');

  return [
    'run-',
    String(now.getFullYear()),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
  ].join('');
}

