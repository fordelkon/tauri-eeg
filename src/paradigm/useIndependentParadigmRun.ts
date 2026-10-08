import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { finishRun } from '../experiment/api';
import { evaluateParadigmAcceptance } from './paradigmAcceptance';
import { initialParadigmSessionState, paradigmSessionReducer } from './paradigmSessionState';
import { describeParadigmQueueProgress } from './paradigmBlockQueue';
import { isVideoDurationOutOfRange } from './paradigmTimeline';
import { ParadigmExperiment } from './paradigmExperiment';
import { toLibraryErrorMessage } from './paradigmSessionKinds';
import type { StartedParadigmRequest } from './ParadigmSetupPanel';
import type { ParadigmSessionSummary, SelfReport, TrialQuality } from './types';

export function useIndependentParadigmRun({ request, confirm }: {
  request: StartedParadigmRequest;
  confirm: (options: { title: string; description: string }) => Promise<boolean>;
}) {
  const [state, dispatch] = useReducer(paradigmSessionReducer, initialParadigmSessionState);
  const [blockGate, setBlockGate] = useState(-1);
  const [isStartingTrial, setIsStartingTrial] = useState(false);
  const [isEndingTrial, setIsEndingTrial] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [summary, setSummary] = useState<ParadigmSessionSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const experiment = useMemo(() => new ParadigmExperiment(request.runId), [request.runId]);
  const begunRef = useRef(-1);
  const finalizedRef = useRef(-1);
  const phaseRef = useRef('');
  const videoStartedRef = useRef(false);
  const videoEndedRef = useRef(false);
  const videoDurationRef = useRef<number | null>(null);
  const endingRef = useRef(false);
  const finishRef = useRef(false);
  const failedRef = useRef(false);
  const progress = useMemo(() => describeParadigmQueueProgress(state.queue, state.currentTrialIndex, blockGate),
    [state.queue, state.currentTrialIndex, blockGate]);
  const fail = useCallback((error: unknown) => {
    failedRef.current = true;
    dispatch({ type: 'session_failed', message: toLibraryErrorMessage(error) });
    void experiment.interrupt(toLibraryErrorMessage(error))
      .finally(() => finishRun(experiment.runId, 'aborted', toLibraryErrorMessage(error))).catch(() => {});
  }, [experiment]);

  useEffect(() => {
    dispatch({ type: 'enter_setup' });
    dispatch({ type: 'session_started', queue: request.queue, sessionKind: request.sessionKind });
    if (request.runId) dispatch({ type: 'session_id_resolved', sessionId: request.runId });
  }, [request.queue, request.sessionKind, request.runId]);

  useEffect(() => {
    if (state.phase !== 'running' || state.trialPhase !== 'interTrial' || failedRef.current) return;
    const nextIndex = state.currentTrialIndex + 1;
    const plan = state.queue[nextIndex];
    if (!plan || begunRef.current === nextIndex) return;
    if (nextIndex > 0 && progress.blockStarts.includes(nextIndex) && blockGate !== nextIndex) return;
    begunRef.current = nextIndex;
    setIsStartingTrial(true);
    void experiment.begin(plan).then(() => {
      if (failedRef.current) return;
      videoStartedRef.current = false;
      videoEndedRef.current = false;
      videoDurationRef.current = null;
      dispatch({ type: 'trial_started', trialIndex: plan.trialIndex });
    }).catch(fail).finally(() => setIsStartingTrial(false));
  }, [state.phase, state.trialPhase, state.currentTrialIndex, state.queue, progress.blockStarts, blockGate, experiment, fail]);

  useEffect(() => {
    if (state.phase !== 'running') return;
    const event = state.trialPhase === 'hint' ? 'hint_start'
      : state.trialPhase === 'postRest' ? 'post_rest_start' : null;
    if (!event) return;
    const key = `${state.currentTrialIndex}:${event}`;
    if (phaseRef.current === key) return;
    phaseRef.current = key;
    void experiment.event(event).catch(fail);
  }, [state.phase, state.trialPhase, state.currentTrialIndex, experiment, fail]);

  const handleVideoFirstPlay = useCallback(() => {
    if (videoStartedRef.current || failedRef.current) return;
    const plan = state.queue[state.currentTrialIndex];
    if (!plan) return;
    videoStartedRef.current = true;
    void experiment.event(`${plan.emotion}_video_start`, 'html_video_playing').catch(fail);
  }, [state.queue, state.currentTrialIndex, experiment, fail]);
  const handleVideoEnded = useCallback(() => {
    if (videoEndedRef.current || failedRef.current) return;
    videoEndedRef.current = true;
    void experiment.event('induction_video_end', 'html_video_ended')
      .then(() => { if (!failedRef.current) dispatch({ type: 'advance_trial_phase' }); }).catch(fail);
  }, [experiment, fail]);
  const handleVideoError = useCallback(() => {
    if (failedRef.current) return;
    void experiment.event('playback_error', 'video_error').catch(fail);
  }, [experiment, fail]);
  const handleCountdownComplete = useCallback(() => {
    if (failedRef.current) return;
    if (state.trialPhase !== 'postRest') {
      dispatch({ type: 'advance_trial_phase' });
      return;
    }
    if (endingRef.current) return;
    endingRef.current = true;
    setIsEndingTrial(true);
    void experiment.end().then(() => {
      if (!failedRef.current) dispatch({ type: 'trial_ended' });
    }).catch(fail).finally(() => { endingRef.current = false; setIsEndingTrial(false); });
  }, [state.trialPhase, experiment, fail]);
  const handleSelfReportSubmit = useCallback((selfReport: SelfReport) => {
    const plan = state.queue[state.currentTrialIndex];
    if (!plan || failedRef.current) return;
    dispatch({ type: 'self_report_submitted', selfReport,
      suggestedQuality: evaluateParadigmAcceptance(plan.emotion, selfReport.valence, selfReport.arousal) });
  }, [state.queue, state.currentTrialIndex]);

  useEffect(() => {
    if (state.phase !== 'running' || state.trialPhase !== 'qualityCheck' || !state.selfReport
      || finalizedRef.current === state.currentTrialIndex || failedRef.current) return;
    finalizedRef.current = state.currentTrialIndex;
    const flags = videoDurationRef.current !== null && isVideoDurationOutOfRange(videoDurationRef.current)
      ? ['video_duration_out_of_range'] : [];
    const quality: TrialQuality = flags.length ? 'artifact_rejected' : state.suggestedQuality ?? 'accepted';
    setIsFinalizing(true);
    void experiment.finalize(state.selfReport, quality, flags).then(() => {
      if (!failedRef.current) dispatch({ type: 'trial_finalized' });
    }).catch(fail).finally(() => setIsFinalizing(false));
  }, [state.phase, state.trialPhase, state.selfReport, state.currentTrialIndex, state.suggestedQuality, experiment, fail]);
  useEffect(() => {
    if (state.phase !== 'finished' || finishRef.current || failedRef.current) return;
    finishRef.current = true;
    void finishRun(experiment.runId, 'completed').then(() => setSummary(experiment.summary()))
      .catch((error) => { setSummaryError(toLibraryErrorMessage(error)); fail(error); });
  }, [state.phase, experiment, fail]);

  const handleSkipTrial = useCallback(async () => {
    if (isEndingTrial || isFinalizing || failedRef.current) return;
    if (!(await confirm({ title: '跳过该试次？', description: '记录播放失败和跳过事件，将试次标为拒收。' }))) return;
    setIsEndingTrial(true);
    try {
      await experiment.event('playback_error', 'video_error');
      await experiment.event('trial_skip');
      await experiment.event('trial_end');
      await experiment.finalize(null, 'rejected', ['video_playback_failure']);
      dispatch({ type: 'trial_skipped' });
    } catch (error) { fail(error); }
    finally { setIsEndingTrial(false); }
  }, [confirm, isEndingTrial, isFinalizing, experiment, fail]);
  return {
    dispatch, state, progress, blockGate, setBlockGate,
    summary, summaryError, isStartingTrial, isEndingTrial, isFinalizing,
    handleVideoFirstPlay, handleVideoEnded, handleVideoError, handleCountdownComplete, handleSelfReportSubmit, handleSkipTrial,
    handleVideoDurationLoaded: (seconds: number | null) => { videoDurationRef.current = seconds; },
    abortRun: async () => {
      failedRef.current = true;
      dispatch({ type: 'session_failed', message: '实验已中止' });
      try { await experiment.interrupt('操作者提前结束'); }
      finally { await finishRun(experiment.runId, 'aborted'); }
    },
  };
}


