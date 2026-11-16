import {
  EFFECT_FLOW_STEPS,
  EFFECT_FLOW_STEP_COUNT,
  type EffectEventLogStatus,
  type EffectEvaluationFlowState,
  type EffectFlowStep,
} from './effectEvaluationFlow';

/**
 * Pure view-model for the effect-evaluation loop's two visual anchors: the
 * horizontal timeline (six stations: 配置 → 诱发 → 量表 → 调控/静息 → 复测 →
 * 结果) and the single-task main stage card that always presents exactly one
 * node.
 *
 * Rendering-layer only: it reads the flow state and never mutates it, keeps
 * no React/Tauri/DOM access, and never decides gating itself — the state
 * execution module in `effectEvaluationExecution` is the source of truth for
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
   * computed. experiment event log and loading state never change node status;
   * this input only feeds the result node's (defensive) done summary.
   */
  hasResultSummary?: boolean;
};

const SHORT_ID_LENGTH = 8;

const SCALE_STAGE_HINT = '请按此刻的感受，为每个情绪词选择强度。';

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
      return {
        stageTitle: '准备开始评价',
        stageHint: '先在实验设置中确认被试、素材和测量方案，再开始本次评价。',
      };
    case 1:
      if (!state.preInductionRecordId)
        return { stageTitle: '记录观看前的感受', stageHint: SCALE_STAGE_HINT };
      return { stageTitle: '观看视频', stageHint: '准备好后开始播放，观看至结束' };
    case 2:
      return {
        stageTitle: '记录此刻状态',
        stageHint: SCALE_STAGE_HINT,
      };
    // The condition node's noun follows the run condition: 调控 plays media,
    // 静息 (基线条件) just waits. Both advertise the set duration.
    case 3:
      return state.condition === 'natural_recovery'
        ? {
            stageTitle: '静息恢复',
            stageHint: `接下来 ${state.durationMinutes} 分钟请安静坐好，到点会有提醒`,
          }
        : {
            stageTitle: '体验所选素材',
            stageHint: `接下来 ${state.durationMinutes} 分钟请跟随播放内容，到点会有提醒`,
          };
    case 4:
      return {
        stageTitle: '再次记录此刻状态',
        stageHint: SCALE_STAGE_HINT,
      };
    case 5:
      return {
        stageTitle: '查看前后记录',
        stageHint: '比较诱发前、诱发后与条件结束后的评分。',
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

/** Operator-facing copy for the experiment event log badge/hint. The
 * `unavailable` wording is the documented trial-run badge copy
 * (docs/paradigm-protocol.md section 3, 无设备模式). */
const EVENT_LOG_STATUS_COPY: Record<EffectEventLogStatus, string> = {
  'not-started': '实验尚未开始',
  active: '实验事件记录中，BDF 由 ActiView 保存',
  saved: '实验日志已保存',
  interrupted: '实验已中断，请重新开始',
};

export function describeEventLogStatus(association: EffectEventLogStatus): string {
  return EVENT_LOG_STATUS_COPY[association];
}
