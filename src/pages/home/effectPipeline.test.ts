import { describe, expect, test } from 'vitest';
import {
  buildEffectVerdictCopy,
  createEffectEvaluationFlowState,
  type EffectEvaluationFlowState,
  type EffectFlowStep,
} from './effectEvaluationFlow';
import {
  deriveEffectPipelineNodes,
  describeEegAssociation,
  isNodeActionable,
  verdictCopyForCondition,
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
    expect(nodes.map((node) => node.step)).toEqual([0, 1, 2, 3, 4, 5]);
    // One-word station labels feed the horizontal timeline.
    expect(nodes.map((node) => node.shortLabel)).toEqual(['配置', '诱发', '量表', '静息', '复测', '结果']);
    // Current/pending nodes carry no done summary.
    expect(nodes.filter((node) => node.summary !== null)).toHaveLength(0);
    // Status lines exist for every station; pending ones read 未解锁.
    expect(nodes.slice(1).every((node) => node.statusText === '未解锁')).toBe(true);
    expect(nodes[0].statusText).toBe('进行中');
    expect(nodes.every((node) => !node.skipped)).toBe(true);
    // Stage copy: the first task in plain language.
    expect(nodes[0]).toMatchObject({ stageTitle: '设置本次实验', stageHint: '选择被试与调控条件' });
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
      statusText: '被试 subj-001',
    });
    // The induction filename is not recorded in the flow state, so the
    // summary stays generic instead of inventing one.
    expect(nodes[1]).toMatchObject({ step: 1, status: 'done', summary: '已完成', statusText: '已完成' });
    expect(nodes[2]).toMatchObject({
      step: 2,
      status: 'done',
      summary: `量表记录已保存（${baselineRecordId.slice(0, 8)}…）`,
      statusText: '已保存',
    });
    // The condition window is live: the station reads 计时中, not 进行中.
    expect(nodes[3]).toMatchObject({ step: 3, status: 'current', summary: null, statusText: '计时中' });
    expect(nodes[4]).toMatchObject({ step: 4, status: 'pending', summary: null, statusText: '未解锁' });
    expect(nodes[5]).toMatchObject({ step: 5, status: 'pending', summary: null, statusText: '未解锁' });
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
    expect(nodes[3].statusText).toBe('已跳过');
    expect(nodes.filter((node) => node.step !== 3).every((node) => !node.skipped)).toBe(true);

    // The unskipped condition row keeps the plain summary.
    const unskipped = deriveEffectPipelineNodes(stateAtStep(4));
    expect(unskipped[3].skipped).toBe(false);
    expect(unskipped[3].summary).toBe('已完成');
    expect(unskipped[3].statusText).toBe('已完成');
  });

  test('the condition station renames with the run condition and branches the stage copy', () => {
    // 调控条件: media relaxation with the set duration advertised.
    const regulation = deriveEffectPipelineNodes(stateAtStep(3, { condition: 'regulation' }));
    expect(regulation[3].shortLabel).toBe('调控');
    expect(regulation[3].stageTitle).toBe('执行调控（音乐/视频）');
    expect(regulation[3].stageHint).toBe('接下来 5 分钟请跟随媒体放松，到点自动提醒');

    // 基线条件（自然恢复）: rest, no media, same duration.
    const natural = deriveEffectPipelineNodes(stateAtStep(3, { condition: 'natural_recovery' }));
    expect(natural[3].shortLabel).toBe('静息');
    expect(natural[3].stageTitle).toBe('静息恢复');
    expect(natural[3].stageHint).toBe('接下来 5 分钟什么都不用做，让情绪自然回落');

    // The duration rides the configured minutes.
    const longer = deriveEffectPipelineNodes(stateAtStep(3, {
      condition: 'regulation',
      durationMinutes: 10,
    }));
    expect(longer[3].stageHint).toContain('10 分钟');
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
    expect(withoutSummary[5]).toMatchObject({
      step: 5,
      status: 'current',
      summary: null,
      stageTitle: '查看改善结果',
    });

    // The result-data existence input never flips the node's status/summary
    // while the node stays current (the stage renders the live data).
    const withSummary = deriveEffectPipelineNodes(base, { hasResultSummary: true });
    expect(withSummary[5]).toMatchObject({ status: 'current', summary: null });
  });

  test('stage copy covers every step in plain-language task form', () => {
    const nodes = deriveEffectPipelineNodes(createEffectEvaluationFlowState());
    const titles = nodes.map((node) => node.stageTitle);

    expect(titles).toEqual([
      '设置本次实验',
      '观看诱发视频',
      '记录此刻状态',
      '静息恢复',
      '再次记录此刻状态',
      '查看改善结果',
    ]);
    // Both scale steps advertise the same battery expectations.
    expect(nodes[2].stageHint).toBe(nodes[4].stageHint);
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
  test('only the current node hosts the main stage interaction area', () => {
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

describe('verdictCopyForCondition', () => {
  test('keeps the regulation-condition verdict copy untouched', () => {
    const copy = buildEffectVerdictCopy({ meanImprovementRate: 0.4, meetsThreshold: true });

    expect(verdictCopyForCondition(copy, 'regulation')).toBe(copy);
  });

  test('rephrases the success tail for the natural-recovery leg', () => {
    const copy = buildEffectVerdictCopy({ meanImprovementRate: 0.4, meetsThreshold: true });
    const adjusted = verdictCopyForCondition(copy, 'natural_recovery');

    expect(adjusted.severity).toBe('success');
    expect(adjusted.title).toBe(copy.title);
    expect(adjusted.detail).toContain('本次静息恢复判定为有效');
    expect(adjusted.detail).not.toContain('本次调控判定为有效');
    // The threshold math stays in the sentence.
    expect(adjusted.detail).toContain('+40%');
  });

  test('leaves the warning verdict (condition-neutral detail) alone', () => {
    const below = buildEffectVerdictCopy({ meanImprovementRate: -0.05, meetsThreshold: false });
    expect(verdictCopyForCondition(below, 'natural_recovery')).toBe(below);

    const unjudgeable = buildEffectVerdictCopy({ meanImprovementRate: null, meetsThreshold: false });
    expect(verdictCopyForCondition(unjudgeable, 'natural_recovery')).toBe(unjudgeable);
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

    // Final board: five completed stations, the result station current.
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
    expect(finalNodes[3].statusText).toBe('已跳过');
    expect(finalNodes[4].summary).toBe('量表记录已保存（ccccdddd…）');
  });
});
