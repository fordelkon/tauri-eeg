import {
  EFFECT_FLOW_STEPS,
  EFFECT_FLOW_STEP_COUNT,
  type EffectEegAssociation,
  type EffectEvaluationFlowState,
  type EffectFlowStep,
} from './effectEvaluationFlow';

/**
 * Pure view-model for the single-page pipeline board of the effect-evaluation
 * loop: the six wizard steps (0 配置 → 1 情绪诱发 → 2 诱发后量表 → 3 条件执行 →
 * 4 条件后量表 → 5 结果评价) rendered as always-visible node cards.
 *
 * Rendering-layer only: it reads the flow state and never mutates it, keeps
 * no React/Tauri/DOM access, and never decides gating itself — the state
 * machine in `effectEvaluationFlow` remains the single source of truth for
 * which step is reachable. Free of React so the node derivation is
 * unit-testable in the node vitest environment.
 */

export type EffectPipelineNodeStatus = 'pending' | 'current' | 'done';

export type EffectPipelineNode = {
  step: EffectFlowStep;
  status: EffectPipelineNodeStatus;
  /** Step title, identical to the same index of EFFECT_FLOW_STEPS. */
  title: string;
  /** Summary copy for done nodes; pending/current nodes carry null. */
  summary: string | null;
  /** Skip marker; only the condition node (step 3) can ever carry it. */
  skipped: boolean;
};

export type EffectPipelineOptions = {
  /**
   * Whether the result-step summary data (the hook's `summary`) has been
   * computed. EEG association and loading state never change node status;
   * this input only feeds the result node's (defensive) done summary.
   */
  hasResultSummary?: boolean;
};

const SHORT_ID_LENGTH = 8;

function shortId(id: string): string {
  return `${id.slice(0, SHORT_ID_LENGTH)}…`;
}

/** Completed scale-step summary: 「已保存」 plus the record-id existence. */
function scaleDoneSummary(recordId: string | null): string {
  return recordId ? `量表记录已保存（${shortId(recordId)}）` : '已完成';
}

function doneSummaryFor(
  step: EffectFlowStep,
  state: EffectEvaluationFlowState,
  options: EffectPipelineOptions,
): string | null {
  switch (step) {
    case 0: {
      const subjectId = state.subjectId.trim();
      return subjectId.length > 0 ? `配置完成 · 被试 ${subjectId}` : '配置完成';
    }
    // The induction video filename is not part of the flow state, so the
    // summary stays generic instead of inventing a record that does not exist.
    case 1:
      return '已完成';
    case 2:
      return scaleDoneSummary(state.baselineRecordId);
    case 3:
      return state.regulationSkipped ? '已完成 · 已跳过剩余时长' : '已完成';
    case 4:
      return scaleDoneSummary(state.postRecordId);
    case 5:
      // Node 5 has no done state while step stays <= 5 (step 5 renders as
      // current); this branch only guards a state that the parser cannot
      // produce today, keyed on whether the result data exists.
      return options.hasResultSummary ? '结果数据已生成' : null;
  }
}

/**
 * Derives the six pipeline node descriptors from the flow state. A node is
 * `done` iff the flow step is strictly past it, `current` iff the flow step
 * equals it (node 5 therefore renders as `current` at step 5 — it has no
 * done state), and `pending` otherwise.
 */
export function deriveEffectPipelineNodes(
  state: EffectEvaluationFlowState,
  options: EffectPipelineOptions = {},
): EffectPipelineNode[] {
  const nodes: EffectPipelineNode[] = [];

  for (let index = 0; index < EFFECT_FLOW_STEP_COUNT; index += 1) {
    const step = index as EffectFlowStep;
    const status: EffectPipelineNodeStatus =
      state.step > index ? 'done' : state.step === index ? 'current' : 'pending';

    nodes.push({
      step,
      status,
      title: EFFECT_FLOW_STEPS[index],
      summary: status === 'done' ? doneSummaryFor(step, state, options) : null,
      skipped: step === 3 ? state.regulationSkipped : false,
    });
  }

  return nodes;
}

/** Only the current node hosts an interactive area on the board. */
export function isNodeActionable(node: EffectPipelineNode): boolean {
  return node.status === 'current';
}

/** Operator-facing copy for the EEG association badge/hint. The
 * `unavailable` wording is the documented trial-run badge copy
 * (docs/paradigm-protocol.md section 3, 无设备模式). */
const EEG_ASSOCIATION_COPY: Record<EffectEegAssociation, string> = {
  'not-started': '未关联 EEG 记录',
  recording: '正在关联 EEG 记录',
  saved: 'EEG 记录已保存',
  unavailable: '试运行 · 未记录 EEG',
};

export function describeEegAssociation(association: EffectEegAssociation): string {
  return EEG_ASSOCIATION_COPY[association];
}
