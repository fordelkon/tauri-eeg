import { useMemo } from 'react';
import { deriveEffectPipelineNodes, type EffectPipelineNode } from './effectPipeline';
import type { EffectEvaluationFlowState } from './effectEvaluationFlow';

/**
 * Timeline view-model for the effect-evaluation page: recomputed only when a
 * field the pure pipeline derivation actually reads changes (step, subjectId,
 * condition, durationMinutes, regulationStartedAtMs, regulationSkipped, and
 * the two record ids — keep this list in sync with
 * `deriveEffectPipelineNodes`) or when the result summary's existence flips.
 * Unrelated dispatches (e.g. the EEG badge flip) keep the same node objects,
 * letting the memoized timeline/done band bail out.
 */
export function useEffectPipelineNodes(
  state: EffectEvaluationFlowState,
  hasResultSummary: boolean,
): {
  pipelineNodes: EffectPipelineNode[];
  doneNodes: EffectPipelineNode[];
  currentNode: EffectPipelineNode;
} {
  const pipelineNodes = useMemo(
    () => deriveEffectPipelineNodes(state, { hasResultSummary }),
    [
      state.step,
      state.subjectId,
      state.condition,
      state.durationMinutes,
      state.regulationStartedAtMs,
      state.regulationSkipped,
      state.baselineRecordId,
      state.postRecordId,
      hasResultSummary,
    ],
  );
  const doneNodes = useMemo(
    () => pipelineNodes.filter((node) => node.status === 'done'), [pipelineNodes],
  );
  const currentNode = pipelineNodes[state.step];

  return { currentNode, doneNodes, pipelineNodes };
}
