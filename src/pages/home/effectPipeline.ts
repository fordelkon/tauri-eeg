import {
  EFFECT_FLOW_STEPS,
  EFFECT_FLOW_STEP_COUNT,
  type EffectCondition,
  type EffectEegAssociation,
  type EffectEvaluationFlowState,
  type EffectFlowStep,
  type EffectVerdictCopy,
} from './effectEvaluationFlow';

/**
 * Pure view-model for the effect-evaluation loop's two visual anchors: the
 * horizontal timeline (six stations: 配置 → 诱发 → 量表 → 调控/静息 → 复测 →
 * 结果) and the single-task main stage card that always presents exactly one
 * node.
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
  /** One-word station label under the timeline dot (配置/诱发/量表/…). */
  shortLabel: string;
  /** One-line status text under the station label (进行中/已保存/未解锁). */
  statusText: string | null;
  /** Plain-language task title of the main stage card. */
  stageTitle: string;
  /** One-sentence guidance under the stage title. */
  stageHint: string;
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

/**
 * Shared stage hint of the two scale steps (nodes 2/4). The battery core is
 * 40 items (STAI-S 20 + PANAS 20), but the optional sections ride the same
 * dialog (SAM +3 on the baseline leg, GEMS-9 +9 on the music post leg), so
 * the honest planning range is 40-49 items / 3-4 minutes — a fixed "40 题"
 * would understate the participant time whenever an optional section ran.
 * One shared string keeps nodes 2/4 advertising the same expectations.
 */
const SCALE_STAGE_HINT = '40-49 题 · 约 3-4 分钟 · 凭第一感受作答';

function shortId(id: string): string {
  return `${id.slice(0, SHORT_ID_LENGTH)}…`;
}

/** One-word timeline label; the condition node renames by run condition. */
function shortLabelFor(step: EffectFlowStep, state: EffectEvaluationFlowState): string {
  switch (step) {
    case 0:
      return '配置';
    case 1:
      return '诱发';
    case 2:
      return '量表';
    case 3:
      return state.condition === 'natural_recovery' ? '静息' : '调控';
    case 4:
      return '复测';
    case 5:
      return '结果';
  }
}

/** Plain-language stage copy: what the operator does right now, no jargon. */
function stageCopyFor(
  step: EffectFlowStep,
  state: EffectEvaluationFlowState,
): { stageTitle: string; stageHint: string } {
  switch (step) {
    case 0:
      return { stageTitle: '设置本次实验', stageHint: '选择被试与调控条件' };
    case 1:
      return { stageTitle: '观看诱发视频', stageHint: '视频将自动播放，结束后自动进入记录环节' };
    case 2:
      return { stageTitle: '记录此刻状态', stageHint: SCALE_STAGE_HINT };
    // The condition node's noun follows the run condition: 调控 plays media,
    // 静息 (基线条件) just waits. Both advertise the set duration.
    case 3:
      return state.condition === 'natural_recovery'
        ? {
          stageTitle: '静息恢复',
          stageHint: `接下来 ${state.durationMinutes} 分钟什么都不用做，让情绪自然回落`,
        }
        : {
          stageTitle: '执行调控（音乐/视频）',
          stageHint: `接下来 ${state.durationMinutes} 分钟请跟随媒体放松，到点自动提醒`,
        };
    case 4:
      return { stageTitle: '再次记录此刻状态', stageHint: SCALE_STAGE_HINT };
    case 5:
      return {
        stageTitle: '查看改善结果',
        stageHint: '两次量表各维度的改善率与 10% 阈值判定，就地呈现并可导出报告',
      };
  }
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

/** One-line timeline status: the shortest honest state per station. */
function statusTextFor(
  step: EffectFlowStep,
  status: EffectPipelineNodeStatus,
  state: EffectEvaluationFlowState,
  options: EffectPipelineOptions,
): string | null {
  if (status === 'pending') {
    return '未解锁';
  }

  if (status === 'current') {
    // A running condition window reads as 计时中 — the one state where
    // "进行中" would hide that the clock (not the operator) is driving.
    return step === 3 && state.regulationStartedAtMs !== null ? '计时中' : '进行中';
  }

  switch (step) {
    case 0: {
      const subjectId = state.subjectId.trim();
      return subjectId.length > 0 ? `被试 ${subjectId}` : '已配置';
    }
    case 1:
      return '已完成';
    case 2:
      return '已保存';
    case 3:
      return state.regulationSkipped ? '已跳过' : '已完成';
    case 4:
      return '已保存';
    case 5:
      return options.hasResultSummary ? '已生成' : '已完成';
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
    const stageCopy = stageCopyFor(step, state);

    nodes.push({
      step,
      status,
      title: EFFECT_FLOW_STEPS[index],
      shortLabel: shortLabelFor(step, state),
      statusText: statusTextFor(step, status, state, options),
      stageTitle: stageCopy.stageTitle,
      stageHint: stageCopy.stageHint,
      summary: status === 'done' ? doneSummaryFor(step, state, options) : null,
      skipped: step === 3 ? state.regulationSkipped : false,
    });
  }

  return nodes;
}

/** Only the current node hosts the main stage's interactive area. */
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

/* ------------------------------------------------------------------ */
/* Condition-aware result copy                                          */
/* ------------------------------------------------------------------ */

/**
 * The single-run verdict builder is shared by both conditions, but its
 * success tail claims “本次调控判定为有效” — on a natural-recovery (基线)
 * leg nothing was regulated, so that sentence would be false on the run's
 * primary output screen. This adapter rewords only that tail; the threshold
 * math and the worsening note are condition-neutral and pass through
 * untouched. The source string is matched dynamically so future rewording
 * of the shared builder degrades to a no-op instead of drifting.
 */
export function verdictCopyForCondition(
  copy: EffectVerdictCopy,
  condition: EffectCondition,
): EffectVerdictCopy {
  if (condition !== 'natural_recovery') {
    return copy;
  }

  if (!copy.detail.includes('本次调控判定为有效')) {
    return copy;
  }

  return {
    ...copy,
    detail: copy.detail.replace('本次调控判定为有效', '本次静息恢复判定为有效'),
  };
}
