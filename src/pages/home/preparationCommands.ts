import type { WorkspaceCommand } from '../../agent/workspaceCommands';
import { getPreparationInstructions, steps } from './experimentPreparationSteps';

type PreparationCommandsOptions = {
  step: number;
  goToStep: (step: number) => void;
  enter: () => string;
  destinationLabel: string;
  blockers: string[];
  busy: boolean;
  formal: boolean;
};

export function getPreparationCommands({
  step,
  goToStep,
  enter,
  destinationLabel,
  blockers,
  busy,
  formal,
}: PreparationCommandsOptions): WorkspaceCommand[] {
  const stepHelp = getPreparationInstructions(step, formal).join(' ');
  const help = { label: '查看本步提示', guidance: true, run: () => stepHelp };
  const nextAliases = ['下一步', '继续', 'next'];
  if (busy)
    return [{ ...help, aliases: nextAliases, run: () => `当前操作正在处理中。${stepHelp}` }];

  const moveTo = (target: number) => {
    goToStep(target);
    return `已进入第 ${target + 1} 步「${steps[target].title}」。`;
  };
  const commands: WorkspaceCommand[] = [];
  if (step < steps.length - 1) {
    commands.push({
      label: `下一步：${steps[step + 1].title}`,
      aliases: nextAliases,
      run: () => moveTo(step + 1),
    });
  } else {
    const enterLabel = `进入${destinationLabel}`;
    commands.push(
      blockers.length
        ? {
            label: '查看待办事项',
            aliases: [...nextAliases, '开始实验', enterLabel],
            run: () => blockers.join(' '),
          }
        : { label: enterLabel, aliases: [...nextAliases, '开始实验'], run: enter },
    );
  }
  if (step > 0) commands.push({ label: '上一步', run: () => moveTo(step - 1) });
  commands.push(help);
  return commands;
}
