import type { ExperimentMode } from './api';

export const DEVELOPMENT_BUILD = __EXPERIMENT_DEV__;

export function canUseRehearsalTools(mode: ExperimentMode): boolean {
  return __EXPERIMENT_DEV__ && mode === 'rehearsal';
}
