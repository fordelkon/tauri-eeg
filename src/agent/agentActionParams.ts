/**
 * Planner action parameter plumbing shared by the experiment-agent hook and
 * the planner request module: the normalized param record shape, the typed
 * getters used at action-execution time, and the uniform failure copy.
 */

export type AgentActionParamValue = string | number | boolean | string[];
export type AgentActionParams = Record<string, AgentActionParamValue>;

export function normalizeAgentActionParams(params: Record<string, AgentActionParamValue> | undefined): AgentActionParams {
  return params ?? {};
}

export function getPlannerStringParam(params: AgentActionParams, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function getPlannerDurationParam(params: AgentActionParams): number | null {
  const value = params.duration;
  return typeof value === 'number' && Number.isFinite(value) && value >= 5 && value <= 120 ? value : null;
}

export function formatAgentActionError(reason: unknown): string {
  const detail = reason instanceof Error ? reason.message : String(reason);
  return `操作执行失败：${detail}`;
}
