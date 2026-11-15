import type { WorkspaceCommand } from '../../agent/workspaceCommands';
import type { EffectPipelineNode } from './effectPipeline';

type Options = {
  currentNode: EffectPipelineNode;
  interrupted: boolean;
  showingHistory: boolean;
  showHistory: (show: boolean) => void;
  openSettings: () => void;
  openScale: (() => void) | null;
};

export function getEvaluationCommands({
  currentNode,
  interrupted,
  showingHistory,
  showHistory,
  openSettings,
  openScale,
}: Options): WorkspaceCommand[] {
  const { step, shortLabel, stageTitle, stageHint } = currentNode;
  const guidance = interrupted
    ? '本次评价已中断，请按页面提示重置。'
    : `${stageTitle}。${stageHint}`;
  const commands: WorkspaceCommand[] = [];
  const aliases = ['下一步', '继续', '开始实验', 'next'];

  if (showingHistory) {
    return [
      {
        label: '返回评价向导',
        aliases,
        run: () => {
          showHistory(false);
          return guidance;
        },
      },
      {
        label: '查看历史记录说明',
        guidance: true,
        run: () => '历史记录列出已保存的评价。要继续当前评价，请返回评价向导。',
      },
    ];
  }
  if (step === 0) {
    commands.push({
      label: '打开实验设置',
      aliases,
      run: () => {
        openSettings();
        return '已打开实验设置。';
      },
    });
  }
  if (openScale) {
    commands.push({
      label: '开始填写',
      aliases,
      run: () => {
        openScale();
        return '请在量表窗口填写并提交。';
      },
    });
  }
  commands.push({ label: `查看${shortLabel}提示`, aliases, guidance: true, run: () => guidance });
  if (step === 0 || step === 5) {
    commands.push({
      label: '查看历史记录',
      run: () => {
        showHistory(true);
        return '已打开评价历史记录。';
      },
    });
  }
  return commands;
}
