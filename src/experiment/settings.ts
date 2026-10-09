import type { ExperimentMode } from './api';

export type ExperimentPreferences = {
  mode: ExperimentMode;
  externalRecordingConfirmed: boolean;
  expectedRecordingName: string;
};
export const EXPERIMENT_PREFERENCES_KEY = 'biosemi.experimentPreferences.v1';
const defaults: ExperimentPreferences = {
  mode: 'rehearsal',
  externalRecordingConfirmed: false,
  expectedRecordingName: '',
};

export function parseExperimentPreferences(raw: string | null): ExperimentPreferences {
  if (!raw) return { ...defaults };
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('mode' in value) ||
      !('expectedRecordingName' in value)
    )
      return { ...defaults };
    return {
      mode: value.mode === 'formal' ? 'formal' : 'rehearsal',
      expectedRecordingName:
        typeof value.expectedRecordingName === 'string' ? value.expectedRecordingName : '',
      externalRecordingConfirmed:
        'externalRecordingConfirmed' in value && value.externalRecordingConfirmed === true,
    };
  } catch {
    return { ...defaults };
  }
}

export function readExperimentPreferences(): ExperimentPreferences {
  try {
    return parseExperimentPreferences(window.sessionStorage.getItem(EXPERIMENT_PREFERENCES_KEY));
  } catch {
    return { ...defaults };
  }
}

export function writeExperimentPreferences(preferences: ExperimentPreferences) {
  window.sessionStorage.setItem(EXPERIMENT_PREFERENCES_KEY, JSON.stringify(preferences));
}

export function consumeRecordingConfirmation() {
  const preferences = readExperimentPreferences();
  writeExperimentPreferences({ ...preferences, externalRecordingConfirmed: false });
}
