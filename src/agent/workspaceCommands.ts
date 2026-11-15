import { useLayoutEffect, useSyncExternalStore } from 'react';
import { classifyStepRequest, normalizeAgentInput } from './agentIntent';

export type WorkspaceCommand = {
  label: string;
  guidance?: boolean;
  aliases?: readonly string[];
  run: () => string;
};

export function matchWorkspaceCommand(commands: readonly WorkspaceCommand[], input: string) {
  const step = classifyStepRequest(input);
  if (step === 'hold') return undefined;
  if (step === 'help') return commands.find((command) => command.guidance);
  if (/[？?]/.test(input)) return undefined;
  const text = step === 'advance' ? '下一步' : normalizeAgentInput(input).toLowerCase();
  return commands.find(({ label, aliases = [] }) =>
    [label, ...aliases].some((phrase) => normalizeAgentInput(phrase).toLowerCase() === text),
  );
}

type WorkspacePath = '/experiment-settings' | '/effect-evaluation';
const listeners = new Set<() => void>();
let page: { path: WorkspacePath; commands: readonly WorkspaceCommand[] } | null = null;
let labels: readonly string[] = [];

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: typeof page) {
  const previousPath = page?.path;
  page = next;
  const nextLabels = next?.commands.map((command) => command.label) ?? [];
  if (
    previousPath === next?.path &&
    labels.length === nextLabels.length &&
    labels.every((label, index) => label === nextLabels[index])
  )
    return;
  labels = nextLabels;
  listeners.forEach((listener) => listener());
}

/** The mounted page owns availability and execution. Refresh callbacks on every commit
 * so a command with an unchanged label still uses the latest form and readiness. */
export function usePublishWorkspaceCommands(path: WorkspacePath, commands: WorkspaceCommand[]) {
  useLayoutEffect(() => {
    publish({ path, commands });
  });
  useLayoutEffect(
    () => () => {
      if (page?.path === path) publish(null);
    },
    [path],
  );
}

export function useWorkspaceCommandLabels(path: string) {
  const snapshot = () => (page?.path === path ? labels : null);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function runWorkspaceCommand(path: string, input: string) {
  return page?.path === path ? matchWorkspaceCommand(page.commands, input)?.run() : undefined;
}
