import type { EffectEvaluationFlowState } from './state';
import { parseFlowState } from './state';

/**
 * sessionStorage persistence shared by the wizard and every context consumer
 * (regulation pages, paradigm start gate), plus the "a run leg is happening
 * right now" fact consumed by the mutual-exclusion guards (shell navigation,
 * paradigm start).
 */
/** sessionStorage key shared by the wizard and every context consumer
 * (regulation pages, paradigm start gate). */
export const FLOW_STORAGE_KEY = 'effectEvaluation.flowState.v1';

/** Minimal storage surface so node tests can pass plain objects. */
export type FlowStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readFlowStateFromStorage(
  storage: Pick<FlowStorage, 'getItem'>,
): EffectEvaluationFlowState | null {
  try {
    return parseFlowState(storage.getItem(FLOW_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function serializeFlowState(state: EffectEvaluationFlowState): string {
  return JSON.stringify(state);
}

/** Best-effort write; an unavailable storage just disables run resume. */
export function writeFlowStateToStorage(storage: FlowStorage, state: EffectEvaluationFlowState): void {
  try {
    storage.setItem(FLOW_STORAGE_KEY, serializeFlowState(state));
  } catch {
    // Ignore.
  }
}

export function clearFlowStateFromStorage(storage: FlowStorage): void {
  try {
    storage.removeItem(FLOW_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

/**
 * True while the condition-execution step's wall-clock window is running
 * (started, not yet left). This is the "a run leg is happening right now"
 * fact consumed by the mutual-exclusion guards (shell navigation, paradigm
 * start) - it holds for both conditions so a natural-recovery run blocks a
 * paradigm session just like a regulation run does.
 */
export function isRegulationWindowOpen(state: EffectEvaluationFlowState): boolean {
  return state.step === 3 && state.regulationStartedAtMs !== null;
}

export function isRegulationWindowOpenInStorage(storage: FlowStorage): boolean {
  const state = readFlowStateFromStorage(storage);
  return state !== null && isRegulationWindowOpen(state);
}
