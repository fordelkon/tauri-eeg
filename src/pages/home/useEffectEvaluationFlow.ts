import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { createRun, emitEvent, finishRun, linkScale } from '../../experiment/api';
import { consumeRecordingConfirmation, readExperimentPreferences } from '../../experiment/settings';
import { getParadigmSessionStatus } from '../../paradigm/paradigmSessionStatus';
import { buildBatteryMentalScaleStatus, updateMentalScaleStatus } from '../../mentalScale/mentalScaleStatus';
import { STAI_PANAS_BATTERY_SCALE_ID, batteryDimensionKeys, buildBatteryDefinition, buildBatteryRawAnswers, computeBatteryDimensions, type BatteryAnswers } from '../../mentalScale/instruments/battery';
import { recordScaleCompletion } from '../../mentalScale/scaleCompletion';
import { readStoredSubjectId, writeStoredSubjectId } from '../../storage/currentSubject';
import { savePhaseInstrumentRecord, type ScalePhase } from '../../mentalScale/scaleRecordsApi';
import { describeFriendlyError } from '../../ui/friendlyError';
import { clearFlowStateFromStorage, createEffectEvaluationFlowState, readFlowStateFromStorage, regulationPathForMethod, setupBlockingReason, writeFlowStateToStorage, type EffectEvaluationFlowState } from './effectEvaluationFlow';
import { useEffectInductionPool } from './useEffectInductionPool';
import { useEffectRegulationPool } from './useEffectRegulationPool';
import { useEffectResultReports } from './useEffectResultReports';

const BASELINE_SCALE_DEFINITION = buildBatteryDefinition({ includeSam: true });

export function useEffectEvaluationFlow() {
  const { currentUser } = useAuth();
  const [storedInitialState] = useState(() => readFlowStateFromStorage(window.sessionStorage));
  const [state, setState] = useState<EffectEvaluationFlowState>(() => storedInitialState
    ? { ...storedInitialState, interrupted: storedInitialState.runId !== null && storedInitialState.step < 5 }
    : { ...createEffectEvaluationFlowState(), subjectId: readStoredSubjectId() });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [isSavingScale, setIsSavingScale] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const sentEvents = useRef(new Set<string>());
  const operationPending = useRef(false);
  const { inductionStatus, isInductionPoolLoading } = useEffectInductionPool(state.emotion, state.step);
  const { isRegulationPoolLoading, regulationPoolStatus } = useEffectRegulationPool(state.condition === 'regulation' && state.method === 'video', state.step);
  const resultReports = useEffectResultReports(state);

  useEffect(() => { writeFlowStateToStorage(window.sessionStorage, state); }, [state]);
  useEffect(() => {
    if (storedInitialState?.runId && storedInitialState.step < 5) {
      void finishRun(storedInitialState.runId, 'aborted').catch(error => setActionError(describeFriendlyError(error, '关闭中断实验')));
      setActionError('实验页面已重新加载，本次运行已中断。请重置并创建新实验，不能补发旧标记。');
    }
  }, [storedInitialState]);
  useEffect(() => () => {
    const current = stateRef.current;
    if (current.runId && current.step < 5 && !current.interrupted) void finishRun(current.runId, 'aborted').catch(() => {});
  }, []);

  const failRun = useCallback(async (error: unknown) => {
    const current = stateRef.current;
    setActionError(describeFriendlyError(error, '实验事件发送'));
    setState(value => ({ ...value, interrupted: true, eventLogStatus: 'interrupted' }));
    if (current.runId) await finishRun(current.runId, 'aborted').catch(() => {});
  }, []);

  const event = useCallback(async (eventName: string, phase: string, mediaId?: string, details?: unknown) => {
    const current = stateRef.current;
    if (!current.runId || current.interrupted) throw new Error('实验未启动或已中断，请重置后重新开始。');
    const eventId = `${current.runId}:${phase}:${eventName}`;
    if (sentEvents.current.has(eventId)) return;
    sentEvents.current.add(eventId);
    try {
      const source = eventName === 'music_regulation_start' ? 'html_audio_playing'
        : eventName.endsWith('video_start') || eventName === 'video_regulation_start' ? 'html_video_playing' : 'phase_transition';
      await emitEvent({ runId: current.runId, eventId, phaseInstanceId: `${current.runId}:${phase}`, eventName, mediaId, details, source, frontendMonotonicMs: performance.now() });
    } catch (error) { await failRun(error); throw error; }
  }, [failRun]);

  const postScaleDefinition = useMemo(() => buildBatteryDefinition({ includeGems: state.method === 'music' && state.condition === 'regulation' }), [state.method, state.condition]);
  const scaleDefinitionFor = useCallback((phase: ScalePhase) => phase === 'baseline' ? BASELINE_SCALE_DEFINITION : postScaleDefinition, [postScaleDefinition]);
  const updateDraft = useCallback((patch: Partial<Pick<EffectEvaluationFlowState, 'subjectId' | 'emotion' | 'method' | 'condition' | 'durationMinutes'>>) => {
    if (!stateRef.current.runId) setState(current => ({ ...current, ...patch }));
  }, []);
  const startBaselineMeasurement = useCallback(() => {
    const current = stateRef.current;
    const reason = setupBlockingReason(current);
    if (reason) { setActionError(reason); return; }
    if (getParadigmSessionStatus().active) { setActionError('请先结束当前实验范式。'); return; }
    const preferences = readExperimentPreferences();
    writeStoredSubjectId(current.subjectId.trim());
    setActionError(null);
    setState(value => ({ ...value, runMode: preferences.mode, step: 1 }));
  }, []);
  const beginInduction = useCallback(async () => {
    const current = stateRef.current;
    if (operationPending.current || current.interrupted) return false;
    if (current.runId) return true;
    if (inductionStatus.kind !== 'ready') return false;
    operationPending.current = true;
    setIsStartingRun(true); setActionError(null);
    try {
      const preferences = readExperimentPreferences();
      const run = await createRun({ ...preferences, subjectId: current.subjectId.trim(), userId: currentUser?.id ?? null, flowKind: 'effect_evaluation', emotion: current.emotion, condition: current.condition, method: current.method, durationMinutes: current.durationMinutes, materials: [{ mediaId: inductionStatus.entry.videoId, path: inductionStatus.entry.absolutePath, phase: 'induction' }] });
      if (preferences.mode === 'formal') consumeRecordingConfirmation();
      const next: EffectEvaluationFlowState = { ...current, runId: run.runId, runMode: preferences.mode, eventLogStatus: 'active' };
      stateRef.current = next; setState(next);
      return true;
    } catch (error) { setActionError(describeFriendlyError(error, '开始实验')); return false; }
    finally { operationPending.current = false; setIsStartingRun(false); }
  }, [currentUser?.id, inductionStatus]);

  const inductionOnset = useCallback((mediaId: string) => {
    const name = `${stateRef.current.emotion}_video_start`;
    void event(name, 'induction', mediaId).catch(() => {});
  }, [event]);
  const completeInduction = useCallback(async () => {
    try { await event('induction_video_end', 'induction'); await event('pre_scale_start', 'pre_scale'); setState(value => ({ ...value, step: 2 })); }
    catch { /* The event handler already interrupts the run. */ }
  }, [event]);
  const playbackError = useCallback(() => {
    void event('playback_error', 'playback_error').then(() => failRun(new Error('素材播放失败，本次实验已中断。'))).catch(() => {});
  }, [event, failRun]);

  const completeScaleMeasurement = useCallback(async (phase: ScalePhase, answers: BatteryAnswers) => {
    if (operationPending.current || stateRef.current.interrupted) return;
    operationPending.current = true;
    setIsSavingScale(true); setActionError(null);
    const current = stateRef.current;
    try {
      const dimensionScores = computeBatteryDimensions(answers.stai, answers.panas);
      const record = await savePhaseInstrumentRecord({ userId: currentUser?.id ?? null, subjectId: current.subjectId.trim(), scaleId: STAI_PANAS_BATTERY_SCALE_ID, phase, dimensionScores, rawAnswers: buildBatteryRawAnswers(answers), measuredDimensions: [...batteryDimensionKeys], emotion: current.emotion, condition: current.condition, durationMinutes: current.durationMinutes, regulationSkipped: phase === 'post' ? current.regulationSkipped : false });
      if (!current.runId) throw new Error('缺少实验编号。');
      await linkScale(current.runId, record.id, phase);
      await event(phase === 'baseline' ? 'pre_scale_submit' : 'post_scale_submit', phase === 'baseline' ? 'pre_scale' : 'post_scale');
      if (phase === 'post') await finishRun(current.runId, current.regulationSkipped ? 'aborted' : 'completed');
      updateMentalScaleStatus(buildBatteryMentalScaleStatus(dimensionScores));
      recordScaleCompletion(regulationPathForMethod(current.method));
      setState(value => phase === 'baseline' ? { ...value, baselineRecordId: record.id, step: 3 } : { ...value, postRecordId: record.id, step: 5, eventLogStatus: 'saved' });
    } catch (error) { await failRun(error); }
    finally { operationPending.current = false; setIsSavingScale(false); }
  }, [currentUser?.id, event, failRun]);

  const beginRegulation = useCallback((mediaId?: string, details?: unknown) => {
    const current = stateRef.current;
    if (current.interrupted || current.regulationStartedAtMs !== null) return;
    const name = current.condition === 'natural_recovery' ? 'natural_recovery_start' : `${current.method}_regulation_start`;
    const startedAtMs = Date.now(); const monotonic = performance.now();
    setState(value => ({ ...value, regulationStartedAtMs: startedAtMs, regulationStartedAtMonotonicMs: monotonic }));
    // Update synchronously so duplicate playing callbacks cannot restart the clock.
    stateRef.current = { ...current, regulationStartedAtMs: startedAtMs, regulationStartedAtMonotonicMs: monotonic };
    void event(name, 'condition', mediaId, details).catch(() => {});
  }, [event]);
  const conditionElapsed = useCallback(async () => {
    const current = stateRef.current;
    try { await event(current.condition === 'natural_recovery' ? 'natural_recovery_end' : `${current.method}_regulation_end`, 'condition'); }
    catch { /* Already interrupted. */ }
  }, [event]);
  const leaveRegulationStep = useCallback(async (skipped = false) => {
    if (stateRef.current.interrupted) return;
    try {
      if (skipped) await event('trial_skip', 'condition_skip');
      await conditionElapsed();
      if (stateRef.current.interrupted) return;
      await event('post_scale_start', 'post_scale');
      setState(current => ({ ...current, regulationSkipped: skipped, step: 4 }));
    } catch { /* Already interrupted. */ }
  }, [event, conditionElapsed]);
  const resetFlow = useCallback(async () => {
    if (operationPending.current) return;
    const current = stateRef.current;
    if (current.runId && current.step < 5) {
      try { await finishRun(current.runId, 'aborted'); }
      catch (error) { setActionError(describeFriendlyError(error, '结束实验')); return; }
    }
    sentEvents.current.clear(); resultReports.clearResults();
    setState(createEffectEvaluationFlowState()); clearFlowStateFromStorage(window.sessionStorage); setActionError(null);
  }, [resultReports]);
  const openRegulationPage = useCallback(() => setActionError('运行中请使用当前播放器。独立页面仅用于实验前准备素材。'), []);
  return { ...resultReports, actionError, beginInduction, inductionOnset, playbackError, beginRegulation, conditionElapsed, completeInduction, completeScaleMeasurement, finishRegulation: () => leaveRegulationStep(), inductionStatus, isResumedRun: storedInitialState !== null, isInductionPoolLoading, isRegulationPoolLoading, isSavingScale, isStartingRun, openRegulationPage, resetFlow, regulationPoolStatus, scaleDefinitionFor, skipRemainingRegulation: () => leaveRegulationStep(true), startBaselineMeasurement, state, updateDraft };
}
export type EffectEvaluationFlow = ReturnType<typeof useEffectEvaluationFlow>;
