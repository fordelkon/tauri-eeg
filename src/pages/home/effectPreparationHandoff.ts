import { readExperimentPreferences } from '../../experiment/settings';
import { getParadigmSessionStatus } from '../../paradigm/paradigmSessionStatus';
import { writeStoredSubjectId } from '../../storage/currentSubject';
import {
  createEffectEvaluationFlowState,
  FLOW_STORAGE_KEY,
  parseFlowState,
  readFlowStateFromStorage,
  serializeFlowState,
  type EffectEvaluationFlowState,
  type FlowStorage,
} from './effectEvaluationFlow';

export type EffectPreparationDraft = Pick<
  EffectEvaluationFlowState,
  'subjectId' | 'method' | 'condition' | 'emotion' | 'durationMinutes'
>;

/** Store a prepared session. The participant creates the run at the first measurement. */
export function prepareEffectHandoff(
  draft: EffectPreparationDraft,
  storage: FlowStorage = window.sessionStorage,
): boolean {
  const existing = readFlowStateFromStorage(storage);
  if (getParadigmSessionStatus().active || (existing?.runId && existing.step < 5)) return false;

  const { subjectId, method, condition, emotion, durationMinutes } = draft;
  const prepared: EffectEvaluationFlowState = {
    ...createEffectEvaluationFlowState(),
    step: 1,
    subjectId: subjectId.trim(),
    method,
    condition,
    emotion,
    durationMinutes,
    runMode: readExperimentPreferences().mode,
  };
  if (!prepared.subjectId || !Number.isInteger(durationMinutes)) return false;
  const serialized = serializeFlowState(prepared);
  const parsed = parseFlowState(serialized);
  if (!parsed || parsed.durationMinutes !== durationMinutes) return false;
  try {
    storage.setItem(FLOW_STORAGE_KEY, serialized);
  } catch {
    return false;
  }
  writeStoredSubjectId(prepared.subjectId);
  return true;
}
