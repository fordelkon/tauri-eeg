import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { describeParadigmQueueProgress } from './paradigmBlockQueue';
import { ParadigmExecution } from './paradigmExecution';
import type { StartedParadigmRequest } from './ParadigmSetupPanel';
import type { SelfReport } from './types';

export function useIndependentParadigmRun({ request, confirm }: {
  request: StartedParadigmRequest;
  confirm: (options: { title: string; description: string }) => Promise<boolean>;
}) {
  const execution = useMemo(() => new ParadigmExecution(request), [request]);
  const snapshot = useSyncExternalStore(execution.subscribe, execution.getSnapshot);
  useEffect(() => { execution.start(); }, [execution]);
  const { state, blockGate, summary, summaryError, operation } = snapshot;
  const progress = useMemo(() => describeParadigmQueueProgress(state.queue, state.currentTrialIndex, blockGate),
    [state.queue, state.currentTrialIndex, blockGate]);

  return {
    exitSession: execution.exitSession, state, progress, blockGate, setBlockGate: execution.setBlockGate,
    summary, summaryError, isStartingTrial: operation === 'begin',
    isEndingTrial: operation === 'end' || operation === 'skip', isFinalizing: operation === 'finalize',
    handleVideoFirstPlay: () => { void execution.videoFirstPlay(state); },
    handleVideoEnded: () => { void execution.videoEnded(state); },
    handleVideoError: () => { void execution.videoError(state); },
    handleCountdownComplete: () => { void execution.countdownComplete(state); },
    handleSelfReportSubmit: (selfReport: SelfReport) => execution.selfReportSubmit(state, selfReport),
    handleVideoDurationLoaded: (seconds: number | null) => execution.videoDurationLoaded(state, seconds),
    handleSkipTrial: () => execution.skip(state, () => confirm({
      title: '跳过该试次？', description: '记录播放失败和跳过事件，将试次标为拒收。',
    })),
    abortRun: execution.abort,
  };
}
