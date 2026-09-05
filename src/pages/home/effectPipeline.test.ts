import { describe, expect, test } from 'vitest';
import {
  createEffectEvaluationFlowState,
  EFFECT_FLOW_STEPS,
  type EffectEvaluationFlowState,
  type EffectFlowStep,
} from './effectEvaluationFlow';
import {
  deriveEffectPipelineNodes,
  describeEegAssociation,
  isNodeActionable,
} from './effectPipeline';

/** Flow state fixed at `step` with optional field overrides. */
const stateAtStep = (
  step: number,
  patch: Partial<EffectEvaluationFlowState> = {},
): EffectEvaluationFlowState => ({
  ...createEffectEvaluationFlowState(),
  step: step as EffectFlowStep,
  ...patch,
});

describe('deriveEffectPipelineNodes', () => {
  test('first step renders node 0 as current and every other node pending', () => {
    const nodes = deriveEffectPipelineNodes(createEffectEvaluationFlowState());

    expect(nodes.map((node) => node.status)).toEqual([
      'current',
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    // Titles come straight from EFFECT_FLOW_STEPS, in execution order.
    expect(nodes.map((node) => node.title)).toEqual([...EFFECT_FLOW_STEPS]);
    expect(nodes.map((node) => node.step)).toEqual([0, 1, 2, 3, 4, 5]);
    // Summaries exist only for done nodes; nothing is done at step 0.
    expect(nodes.every((node) => node.summary === null)).toBe(true);
    expect(nodes.every((node) => !node.skipped)).toBe(true);
  });

  test('advancing the flow marks earlier nodes done with state-derived summaries', () => {
    const baselineRecordId = 'baseline-record-0001';
    const nodes = deriveEffectPipelineNodes(stateAtStep(3, {
      subjectId: 'subj-001',
      baselineRecordId,
      regulationStartedAtMs: 1_000,
    }));

    expect(nodes[0]).toMatchObject({
      step: 0,
      status: 'done',
      summary: '配置完成 · 被试 subj-001',
    });
    // The induction filename is not recorded in the flow state, so the
    // summary stays generic instead of inventing one.
    expect(nodes[1]).toMatchObject({ step: 1, status: 'done', summary: '已完成' });
    expect(nodes[2]).toMatchObject({
      step: 2,
      status: 'done',
      summary: `量表记录已保存（${baselineRecordId.slice(0, 8)}…）`,
    });
    expect(nodes[3]).toMatchObject({ step: 3, status: 'current', summary: null });
    expect(nodes[4]).toMatchObject({ step: 4, status: 'pending', summary: null });
    expect(nodes[5]).toMatchObject({ step: 5, status: 'pending', summary: null });
  });

  test('scale summaries reflect the baseline/postRecordId existence', () => {
    // Defensive: a done scale node without a record id degrades to 已完成.
    const withoutRecord = deriveEffectPipelineNodes(stateAtStep(2));
    expect(withoutRecord[2]).toMatchObject({ status: 'current', summary: null });
    expect(withoutRecord[1].summary).toBe('已完成');

    const withPostRecord = deriveEffectPipelineNodes(stateAtStep(5, {
      baselineRecordId: 'aaaabbbb-0000',
      postRecordId: 'ccccdddd-0000',
    }));
    expect(withPostRecord[2].summary).toBe('量表记录已保存（aaaabbbb…）');
    expect(withPostRecord[4].summary).toBe('量表记录已保存（ccccdddd…）');
  });

  test('regulationSkipped is flagged only on the condition node', () => {
    const nodes = deriveEffectPipelineNodes(stateAtStep(4, { regulationSkipped: true }));

    expect(nodes[3].skipped).toBe(true);
    expect(nodes[3].summary).toBe('已完成 · 已跳过剩余时长');
    expect(nodes.filter((node) => node.step !== 3).every((node) => !node.skipped)).toBe(true);

    // The unskipped condition row keeps the plain summary.
    const unskipped = deriveEffectPipelineNodes(stateAtStep(4));
    expect(unskipped[3].skipped).toBe(false);
    expect(unskipped[3].summary).toBe('已完成');
  });

  test('step 5 renders the result node as current — it has no done state', () => {
    const base = stateAtStep(5, {
      baselineRecordId: 'aaaabbbb-0000',
      postRecordId: 'ccccdddd-0000',
    });

    const withoutSummary = deriveEffectPipelineNodes(base);
    expect(withoutSummary.map((node) => node.status)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
      'current',
    ]);
    expect(withoutSummary[5]).toMatchObject({ step: 5, status: 'current', summary: null });

    // The result-data existence input never flips the node's status/summary
    // while the node stays current (its card body renders the live data).
    const withSummary = deriveEffectPipelineNodes(base, { hasResultSummary: true });
    expect(withSummary[5]).toMatchObject({ status: 'current', summary: null });
  });
});

describe('describeEegAssociation', () => {
  test('maps all four association states to operator-facing copy', () => {
    expect(describeEegAssociation('not-started')).toBe('未关联 EEG 记录');
    expect(describeEegAssociation('recording')).toBe('正在关联 EEG 记录');
    expect(describeEegAssociation('saved')).toBe('EEG 记录已保存');
    // Documented trial-run badge copy (docs/paradigm-protocol.md, 无设备模式).
    expect(describeEegAssociation('unavailable')).toBe('试运行 · 未记录 EEG');
  });
});

describe('isNodeActionable', () => {
  test('only the current node hosts an interaction area', () => {
    const nodes = deriveEffectPipelineNodes(stateAtStep(2));

    expect(nodes.map((node) => isNodeActionable(node))).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
    ]);

    // Pending and done nodes are read-only on the board.
    const atResult = deriveEffectPipelineNodes(stateAtStep(5));
    expect(atResult.map((node) => isNodeActionable(node))).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });
});

describe('device-free end-to-end pipeline walk', () => {
  test('eegAssociation unavailable never blocks: every step advances to the result node', () => {
    // The exact state sequence the hook produces during a rehearsal run with
    // no device attached: association flips to 'unavailable' at induction and
    // stays there, yet every node completes (docs/paradigm-protocol.md §3).
    const deviceFreeStates: EffectEvaluationFlowState[] = [
      stateAtStep(0, { subjectId: 'subj-rehearsal' }),
      stateAtStep(1, { subjectId: 'subj-rehearsal', eegAssociation: 'unavailable' }),
      stateAtStep(2, { subjectId: 'subj-rehearsal', eegAssociation: 'unavailable' }),
      stateAtStep(3, {
        subjectId: 'subj-rehearsal',
        eegAssociation: 'unavailable',
        baselineRecordId: 'aaaabbbb-1000',
        regulationStartedAtMs: 1_000,
      }),
      stateAtStep(4, {
        subjectId: 'subj-rehearsal',
        eegAssociation: 'unavailable',
        baselineRecordId: 'aaaabbbb-1000',
        regulationStartedAtMs: 1_000,
        regulationSkipped: true,
      }),
      stateAtStep(5, {
        subjectId: 'subj-rehearsal',
        eegAssociation: 'unavailable',
        baselineRecordId: 'aaaabbbb-1000',
        regulationStartedAtMs: 1_000,
        regulationSkipped: true,
        postRecordId: 'ccccdddd-1000',
      }),
    ];

    deviceFreeStates.forEach((state, index) => {
      const nodes = deriveEffectPipelineNodes(state);

      // Exactly one actionable node at every step, and it is the active step.
      expect(nodes.filter((node) => isNodeActionable(node))).toHaveLength(1);
      expect(nodes[state.step]).toMatchObject({ status: 'current' });
      if (index > 0) {
        expect(nodes[state.step - 1].status).toBe('done');
      }

      // Before induction the association has not been attempted yet; from the
      // induction step on it degrades to the documented trial-run badge.
      const expectedAssociationCopy = state.eegAssociation === 'unavailable'
        ? '试运行 · 未记录 EEG'
        : '未关联 EEG 记录';
      expect(describeEegAssociation(state.eegAssociation)).toBe(expectedAssociationCopy);
    });

    // Final board: five completed nodes, the result node current.
    const finalNodes = deriveEffectPipelineNodes(deviceFreeStates[5]);
    expect(finalNodes.map((node) => node.status)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
      'current',
    ]);
    expect(finalNodes[0].summary).toBe('配置完成 · 被试 subj-rehearsal');
    expect(finalNodes[3].summary).toBe('已完成 · 已跳过剩余时长');
    expect(finalNodes[4].summary).toBe('量表记录已保存（ccccdddd…）');
  });
});
