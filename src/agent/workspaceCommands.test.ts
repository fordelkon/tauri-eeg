import { describe, expect, it, vi } from 'vitest';
import { getPreparationCommands } from '../pages/home/preparationCommands';
import { getEvaluationCommands } from '../pages/home/evaluationCommands';
import { createEffectEvaluationFlowState } from '../pages/home/effectEvaluationFlow';
import { deriveEffectPipelineNodes } from '../pages/home/effectPipeline';
import { matchWorkspaceCommand } from './workspaceCommands';

describe('preparation shortcuts', () => {
  const setup = (step: number, blockers: string[] = []) => {
    const goToStep = vi.fn();
    const enter = vi.fn(() => '已进入效果评价。');
    const commands = getPreparationCommands({
      step,
      goToStep,
      enter,
      blockers,
      destinationLabel: '效果评价',
      busy: false,
      formal: false,
    });
    return { commands, goToStep, enter };
  };

  it('advances within the preparation wizard and changes the offered next step', () => {
    const first = setup(0);
    const next = matchWorkspaceCommand(first.commands, '下一步');
    expect(next?.label).toContain('连接与测试');
    next?.run();
    expect(first.goToStep).toHaveBeenCalledWith(1);
    const second = setup(1);
    expect(matchWorkspaceCommand(second.commands, '继续')?.label).toContain('准备素材');
    expect(matchWorkspaceCommand(second.commands, '上一步')).toBeDefined();
  });

  it('reports missing requirements on review instead of entering the experiment', () => {
    const review = setup(4, ['请先选择素材库并完成验证。']);
    expect(review.commands.map((command) => command.label)).not.toContain('进入效果评价');
    expect(matchWorkspaceCommand(review.commands, '下一步')?.run()).toContain('素材库');
    expect(review.enter).not.toHaveBeenCalled();
    const ready = setup(4);
    expect(matchWorkspaceCommand(ready.commands, '下一步')?.run()).toBe('已进入效果评价。');
    expect(ready.enter).toHaveBeenCalledOnce();
  });

  it.each(['下一步怎么做？', '下一步怎么做?', '下一步？', '如何继续', '请问下一步是什么'])(
    'answers step questions without moving the wizard: %s',
    (question) => {
      const page = setup(1);
      expect(matchWorkspaceCommand(page.commands, question)?.run()).toContain('排练可跳过设备连接');
      expect(page.goToStep).not.toHaveBeenCalled();
    },
  );

  it('recognizes an explicit polite instruction but never treats a question as a review handoff', () => {
    const review = setup(4);
    expect(matchWorkspaceCommand(review.commands, '下一步?')?.run()).toContain('核对');
    expect(review.enter).not.toHaveBeenCalled();
    matchWorkspaceCommand(review.commands, '请继续！')?.run();
    expect(review.enter).toHaveBeenCalledOnce();
  });
});

describe('evaluation shortcuts', () => {
  const nodes = deriveEffectPipelineNodes(createEffectEvaluationFlowState());
  const setup = (step: number, showingHistory = false, openScale: (() => void) | null = null) => {
    const showHistory = vi.fn();
    const openSettings = vi.fn();
    const commands = getEvaluationCommands({
      currentNode: nodes[step],
      interrupted: false,
      showHistory,
      openSettings,
      showingHistory,
      openScale,
    });
    return { commands, showHistory, openSettings };
  };

  it('tracks the visible tab and the actual phase, including read-only stimulus guidance', () => {
    const result = setup(5);
    matchWorkspaceCommand(result.commands, '查看历史记录')?.run();
    expect(result.showHistory).toHaveBeenCalledWith(true);
    const history = setup(5, true);
    matchWorkspaceCommand(history.commands, '下一步')?.run();
    expect(history.showHistory).toHaveBeenCalledWith(false);
    const induction = setup(1);
    expect(matchWorkspaceCommand(induction.commands, '下一步')?.run()).toContain(
      nodes[1].stageHint,
    );
    expect(induction.openSettings).not.toHaveBeenCalled();
  });

  it('offers to reopen a scale only when the page allows it', () => {
    const open = vi.fn();
    const baseline = setup(2, false, open);
    matchWorkspaceCommand(baseline.commands, '开始填写')?.run();
    expect(open).toHaveBeenCalledOnce();
    expect(matchWorkspaceCommand(setup(2).commands, '开始填写')).toBeUndefined();
  });
});
