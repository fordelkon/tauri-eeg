import type { ExperimentMode } from './api';

export type ExperimentPreferences = {
  mode: ExperimentMode;
  externalRecordingConfirmed: boolean;
  expectedRecordingName: string;
  recordingPlanKey?: string;
};
export const EXPERIMENT_PREFERENCES_KEY = 'biosemi.experimentPreferences.v1';
const defaults: ExperimentPreferences = {
  mode: __EXPERIMENT_DEV__ ? 'rehearsal' : 'formal',
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
    if (!__EXPERIMENT_DEV__ && value.mode !== 'formal') return { ...defaults };
    return {
      mode: value.mode === 'formal' ? 'formal' : 'rehearsal',
      ...('recordingPlanKey' in value && typeof value.recordingPlanKey === 'string'
        ? { recordingPlanKey: value.recordingPlanKey }
        : {}),
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
  const saved = !__EXPERIMENT_DEV__ && preferences.mode !== 'formal' ? defaults : preferences;
  window.sessionStorage.setItem(EXPERIMENT_PREFERENCES_KEY, JSON.stringify(saved));
  return saved;
}

export function consumeRecordingConfirmation() {
  const preferences = readExperimentPreferences();
  writeExperimentPreferences({
    mode: preferences.mode,
    externalRecordingConfirmed: false,
    expectedRecordingName: '',
  });
}
