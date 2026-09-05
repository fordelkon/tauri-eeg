import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useEegSession } from '../eeg/EegSessionContext';
import { getMentalScaleStatusSnapshot } from '../mentalScale/mentalScaleStatus';
import { generateMusic } from '../music/musicGenerationApi';
import {
  type AgentActionId,
  getAgentAction,
  getAgentActionValidation,
} from './agentActions';
import {
  type AgentActionParams,
  formatAgentActionError,
  getPlannerDurationParam,
  getPlannerStringParam,
} from './agentActionParams';
import {
  addAgentTimelineEntry,
  type AgentPersonalizedAnswer,
  type AgentTimelineEntry,
} from './agentContext';
import { executeAgentEegAction } from './agentEegActions';
import { toAgentEegGuardView } from './agentEegGuards';
import { classifyAgentIntent } from './agentIntent';
import { buildAgentMusicPreview } from './agentMusic';
import { requestAgentPlannerRecommendation, type AgentPlannerActionMap } from './agentPlannerRequest';
import { createThinkingBuffer } from './agentThinkingBuffer';
import { findAgentVideoMatch } from './agentVideo';
import {
  type AgentPhase,
  getAgentPromptExamplesForPhase,
  getAgentPhaseForRoute,
  getLocalRegulationPromptExamples,
  getNextAgentPhase,
  getRecommendedPrompt,
  getRouteForAgentPhase,
} from './agentFlow';

export type PendingAgentConfirmation = {
  actionId: AgentActionId;
  label: string;
  params: AgentActionParams;
};

export type UseExperimentAgentOptions = {
  pathname: string;
  navigateTo: (path: string) => void;
};

const plannerActionMap = {
  go_next_page: 'go_next_page',
  skip_game: 'skip_game',
  play_video: 'play_video',
  recommend_video: 'select_video',
  recommend_music: 'generate_music',
} as const satisfies AgentPlannerActionMap;

const localFirstActionIds = new Set<AgentActionId>([
  'go_next_page',
  'start_eeg_device',
  'stop_eeg_device',
  'start_eeg_recording',
  'pause_eeg_recording',
  'resume_eeg_recording',
  'stop_and_save_eeg_recording',
  'start_eeg_device_and_record',
  'stop_save_eeg_and_go_next',
  'skip_game',
  'finish_experiment',
  'cancel',
]);

function isLocalFirstAction(actionId: AgentActionId | 'unknown'): actionId is AgentActionId {
  return actionId !== 'unknown' && localFirstActionIds.has(actionId);
}

export function useExperimentAgent({ pathname, navigateTo }: UseExperimentAgentOptions) {
  // The session context is destructured into the specific fields executeAction
  // reads instead of being carried around as a whole object: the context value
  // changes identity on every display-settings tweak (channel toggles,
  // amplitude, time window) and session transition, and keying the
  // executeAction → queueOrExecute → submitPrompt chain on that whole value
  // re-created submitPrompt — rebinding the agent:submit-prompt and
  // agent:record-action window listeners — on each of those changes. The
  // narrowed deps keep the chain stable unless one of the fields below
  // actually changes.
  const {
    canPauseRecord,
    canResumeRecord,
    canStartDevice,
    canStartRecord,
    canStopDevice,
    canStopRecord,
    deviceStatus,
    pauseRecord,
    recordStatus,
    resumeRecord,
    startDevice,
    startRecord,
    stopDevice,
    stopRecord,
  } = useEegSession();
  const { currentUser } = useAuth();
  const [phase, setPhase] = useState<AgentPhase>(() => getAgentPhaseForRoute(pathname));
  const [message, setMessage] = useState('可以输入“开始实验”或点击推荐操作。');
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingAgentConfirmation | null>(null);
  const [timeline, setTimeline] = useState<AgentTimelineEntry[]>([]);
  const [personalizedAnswers] = useState<AgentPersonalizedAnswer[]>([]);
  const [isPlannerAvailable, setIsPlannerAvailable] = useState(true);
  const [isPlanning, setIsPlanning] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);
  const [thinkingDurationMs, setThinkingDurationMs] = useState<number | null>(null);
  const timelineRef = useRef(timeline);
  // One buffered-thinking accumulator for the hook's whole lifetime (the ref
  // init runs once; setThinkingSteps is a stable setter).
  const thinkingBufferRef = useRef<ReturnType<typeof createThinkingBuffer> | null>(null);
  if (thinkingBufferRef.current === null) {
    thinkingBufferRef.current = createThinkingBuffer(setThinkingSteps);
  }
  const thinkingBuffer = thinkingBufferRef.current;
  const plannerAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setPhase((currentPhase) => getAgentPhaseForRoute(pathname, currentPhase));
  }, [pathname]);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  useEffect(() => {
    return () => {
      plannerAbortRef.current?.abort();
      thinkingBuffer.dispose();
    };
  }, [thinkingBuffer]);

  const recommendedPrompt = useMemo(() => getRecommendedPrompt(phase), [phase]);
  const quickPrompts = useMemo(() => {
    const nextStepPrompt = getAgentPromptExamplesForPhase(phase).find((prompt) => prompt === '下一步');
    const phasePrompts = getAgentPromptExamplesForPhase(phase).filter((prompt) => prompt !== nextStepPrompt);
    const generatedPrompts = getLocalRegulationPromptExamples(phase);

    return [
      recommendedPrompt,
      ...phasePrompts,
      ...generatedPrompts,
      ...(nextStepPrompt ? [nextStepPrompt] : []),
    ];
  }, [phase, recommendedPrompt]);

  const pushTimeline = useCallback((type: AgentTimelineEntry['type'], text: string) => {
    setTimeline((entries) => addAgentTimelineEntry(entries, {
      at: Date.now(),
      phase,
      text,
      type,
    }));
  }, [phase]);

  const flushBufferedThinking = useCallback(() => {
    thinkingBuffer.flush();
  }, [thinkingBuffer]);

  const appendThinkingDelta = useCallback((delta: string) => {
    thinkingBuffer.append(delta);
  }, [thinkingBuffer]);

  const executeAction = useCallback(async (actionId: AgentActionId, params: AgentActionParams = {}) => {
    // Guard view assembled at execution time from the captured primitives —
    // the same committed values the whole session object used to carry here.
    const eegGuardView = toAgentEegGuardView({
      canPauseRecord,
      canResumeRecord,
      canStartDevice,
      canStartRecord,
      canStopDevice,
      canStopRecord,
      deviceStatus,
      recordStatus,
    });
    const validation = getAgentActionValidation(actionId, phase);
    if (!validation.ok) {
      setMessage(validation.reason);
      return;
    }

    pushTimeline('action', actionId);

    switch (actionId) {
      case 'go_next_page': {
        const nextPhase = getNextAgentPhase(phase);
        navigateTo(getRouteForAgentPhase(nextPhase));
        setMessage(`已进入：${getRecommendedPrompt(nextPhase)}`);
        return;
      }
      // The EEG device/record command choreography lives in agentEegActions;
      // each command re-validates its own guard at execution time.
      case 'start_eeg_device':
      case 'stop_eeg_device':
      case 'start_eeg_recording':
      case 'pause_eeg_recording':
      case 'resume_eeg_recording':
      case 'stop_and_save_eeg_recording':
      case 'start_eeg_device_and_record':
      case 'stop_save_eeg_and_go_next':
        await executeAgentEegAction(actionId, {
          eegGuardView,
          phase,
          canStartDevice,
          canStopRecord,
          deviceStatus,
          startDevice,
          stopDevice,
          startRecord,
          pauseRecord,
          resumeRecord,
          stopRecord,
          setMessage,
          navigateTo,
        });
        return;
      case 'select_video': {
        const match = findAgentVideoMatch('放松视频');
        setMessage(match.message);
        return;
      }
      case 'play_video':
        window.dispatchEvent(new CustomEvent('agent:play-video', {
          detail: { videoId: getPlannerStringParam(params, 'videoId') },
        }));
        setMessage('请在视频页面选择素材后播放。');
        return;
      case 'generate_music': {
        const scores = Object.fromEntries(
          getMentalScaleStatusSnapshot().dimensions.map((dimension) => [dimension.key, dimension.value]),
        ) as { anxiety: number; worry: number; mood: number; energy: number };
        const plannerPrompt = getPlannerStringParam(params, 'prompt');
        const plannerDuration = getPlannerDurationParam(params);
        const plannerInstrument = getPlannerStringParam(params, 'instrument');
        const plannerStyle = getPlannerStringParam(params, 'style');
        const plannerDetails = getPlannerStringParam(params, 'details');
        const plannerTags = [
          plannerInstrument,
          plannerStyle,
          plannerDetails,
        ].filter((tag): tag is string => Boolean(tag));
        const preview = buildAgentMusicPreview({ coreScores: scores, personalizedTags: plannerTags.length > 0 ? plannerTags : ['soft'] });
        if (!currentUser) {
          setMessage('请先登录后再生成调控音乐。');
          return;
        }
        window.dispatchEvent(new CustomEvent('agent:music-prompt', {
          detail: {
            instrument: getPlannerStringParam(params, 'instrument'),
            style: getPlannerStringParam(params, 'style'),
            details: getPlannerStringParam(params, 'details'),
            duration: plannerDuration ?? preview.params.duration,
          },
        }));
        // Fire-and-forget: the backend /generate call resolves only when the
        // track finishes (possibly minutes later), and the result already
        // reaches the UI on its own via MUSIC_GENERATED_EVENT plus the history
        // refresh. Awaiting it here would keep the planner in "思考中" and
        // block every follow-up prompt for the whole generation, so resolve
        // this action as "submitted" the moment the request is sent. The
        // floating promise still gets a .catch so a failed submission lands in
        // the same message channel as other action failures instead of
        // becoming an unhandled rejection.
        void generateMusic({
          duration: plannerDuration ?? preview.params.duration,
          prompt: plannerPrompt ?? preview.params.prompt,
          userId: currentUser.id,
          username: currentUser.username,
        }).catch((reason: unknown) => {
          setMessage(formatAgentActionError(reason));
        });
        setMessage('已提交音乐生成请求。');
        return;
      }
      case 'skip_game':
        setPhase('music_regulation');
        navigateTo('/music-regulation');
        setMessage('游戏调控暂不可用，已进入音乐调控。');
        return;
      case 'finish_experiment':
        setPhase('finish');
        navigateTo('/home');
        setMessage('实验流程已完成。');
        return;
      case 'go_to_phase':
      case 'cancel':
        setMessage('已取消当前操作。');
        return;
      default:
        setMessage('无法执行该操作。');
    }
  }, [
    canPauseRecord,
    canResumeRecord,
    canStartDevice,
    canStartRecord,
    canStopDevice,
    canStopRecord,
    currentUser,
    deviceStatus,
    navigateTo,
    pauseRecord,
    phase,
    pushTimeline,
    recordStatus,
    resumeRecord,
    startDevice,
    startRecord,
    stopDevice,
    stopRecord,
  ]);

  const queueOrExecute = useCallback(async (actionId: AgentActionId, forceConfirmation = false, params: AgentActionParams = {}) => {
    const action = getAgentAction(actionId);
    if (!action) {
      setMessage('没有找到可执行的安全操作。');
      return;
    }

    const validation = getAgentActionValidation(action.id, phase);
    if (!validation.ok) {
      setMessage(validation.reason);
      return;
    }

    if (action.requiresConfirmation || forceConfirmation) {
      setPendingConfirmation({
        actionId: action.id,
        label: action.confirmationLabel ?? action.label,
        params,
      });
      pushTimeline('confirmation', action.id);
      return;
    }

    await executeAction(action.id, params);
  }, [executeAction, phase, pushTimeline]);

  const requestPlannerRecommendation = useCallback(async (input: string) => {
    return requestAgentPlannerRecommendation(input, {
      pathname,
      personalizedAnswers,
      phase,
      abortRef: plannerAbortRef,
      timelineRef,
      plannerActionMap,
      onThinkingDelta: appendThinkingDelta,
      flushThinking: flushBufferedThinking,
      queueOrExecute,
      pushTimeline,
      setMessage,
      setIsPlannerAvailable,
      setThinkingSteps,
    });
  }, [appendThinkingDelta, flushBufferedThinking, pathname, personalizedAnswers, phase, queueOrExecute, pushTimeline]);

  const submitPrompt = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed || isPlanning) {
      return;
    }

    setIsPlanning(true);
    setThinkingDurationMs(null);
    setThinkingSteps([]);
    const planningStartedAt = Date.now();

    try {
      pushTimeline('message', trimmed);
      const localIntent = classifyAgentIntent(trimmed);
      if (isLocalFirstAction(localIntent)) {
        setIsPlannerAvailable(true);
        await queueOrExecute(localIntent);
        return;
      }

      const plannerHandled = await requestPlannerRecommendation(trimmed);
      if (plannerHandled) {
        return;
      }

      if (localIntent === 'unknown') {
        setMessage('没有识别该请求，请使用面板中的示例表达。');
      }
    } catch (reason) {
      setMessage(formatAgentActionError(reason));
    } finally {
      flushBufferedThinking();
      setThinkingDurationMs(Date.now() - planningStartedAt);
      setIsPlanning(false);
    }
  }, [flushBufferedThinking, isPlanning, pushTimeline, queueOrExecute, requestPlannerRecommendation]);

  const confirmPendingAction = useCallback(async () => {
    if (!pendingConfirmation) {
      return;
    }

    const actionId = pendingConfirmation.actionId;
    const params = pendingConfirmation.params;
    setPendingConfirmation(null);
    try {
      await executeAction(actionId, params);
    } catch (reason) {
      setMessage(formatAgentActionError(reason));
    }
  }, [executeAction, pendingConfirmation]);

  const rejectPendingAction = useCallback(() => {
    setPendingConfirmation(null);
    setMessage('已取消敏感操作。');
  }, []);

  const cancelPlanning = useCallback(() => {
    if (!isPlanning) {
      return;
    }

    plannerAbortRef.current?.abort();
    setMessage('已取消本次智能助手请求。');
    pushTimeline('planner', '已取消本次智能助手请求。');
  }, [isPlanning, pushTimeline]);

  useEffect(() => {
    const handleSubmitPromptEvent = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt?: unknown }>).detail?.prompt;
      if (typeof prompt === 'string' && prompt.length > 0) {
        void submitPrompt(prompt);
      }
    };

    window.addEventListener('agent:submit-prompt', handleSubmitPromptEvent);
    return () => {
      window.removeEventListener('agent:submit-prompt', handleSubmitPromptEvent);
    };
  }, [submitPrompt]);

  // Page buttons tagged data-agent-action run their own behavior; Home only
  // forwards the fact of the click so it lands on the timeline as planning
  // context — never back through submitPrompt, which would re-plan (and
  // possibly re-execute) an action the user already triggered.
  useEffect(() => {
    const handleRecordActionEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ actionId?: unknown; payload?: unknown }>).detail;
      if (typeof detail?.actionId !== 'string' || detail.actionId.length === 0) {
        return;
      }

      const text = typeof detail.payload === 'string' && detail.payload.length > 0
        ? `${detail.actionId}:${detail.payload}`
        : detail.actionId;
      pushTimeline('action', text);
    };

    window.addEventListener('agent:record-action', handleRecordActionEvent);
    return () => {
      window.removeEventListener('agent:record-action', handleRecordActionEvent);
    };
  }, [pushTimeline]);

  return {
    isPlannerAvailable,
    isPlanning,
    thinkingDurationMs,
    thinkingSteps,
    message,
    pendingConfirmation,
    phase,
    quickPrompts,
    recentTimeline: timeline.slice(-5),
    recommendedPrompt,
    cancelPlanning,
    confirmPendingAction,
    rejectPendingAction,
    submitPrompt,
  };
}
