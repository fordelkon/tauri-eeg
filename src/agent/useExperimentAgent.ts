import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { generateMusic } from '../music/musicGenerationApi';
import { getCurrentRegulationVideos } from '../video/regulationVideoResources';
import { type AgentActionId, getAgentAction, getAgentActionValidation } from './agentActions';
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
import { classifyAgentIntent } from './agentIntent';
import { runWorkspaceCommand, useWorkspaceCommandLabels } from './workspaceCommands';
import { buildAgentMusicPreview } from './agentMusic';
import {
  requestAgentPlannerRecommendation,
  type AgentPlannerActionMap,
} from './agentPlannerRequest';
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
  navigateTo: (path: string) => Promise<string | undefined>;
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
  'open_paradigm',
  'open_experiment_settings',
  'skip_game',
  'finish_experiment',
  'cancel',
]);

function isLocalFirstAction(actionId: AgentActionId | 'unknown'): actionId is AgentActionId {
  return actionId !== 'unknown' && localFirstActionIds.has(actionId);
}

export function useExperimentAgent({ pathname, navigateTo }: UseExperimentAgentOptions) {
  const workspacePrompts = useWorkspaceCommandLabels(pathname);
  const { currentUser } = useAuth();
  const [phase, setPhase] = useState<AgentPhase>(() => getAgentPhaseForRoute(pathname));
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingAgentConfirmation | null>(
    null,
  );
  const [timeline, setTimeline] = useState<AgentTimelineEntry[]>([]);
  const [personalizedAnswers] = useState<AgentPersonalizedAnswer[]>([]);
  const [isPlannerAvailable, setIsPlannerAvailable] = useState(true);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isRequestingPlanner, setIsRequestingPlanner] = useState(false);
  const submittingRef = useRef(false);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);
  const [thinkingDurationMs, setThinkingDurationMs] = useState<number | null>(null);
  const timelineRef = useRef(timeline);
  const thinkingBufferRef = useRef<ReturnType<typeof createThinkingBuffer> | null>(null);
  if (thinkingBufferRef.current === null) {
    thinkingBufferRef.current = createThinkingBuffer(setThinkingSteps);
  }
  const thinkingBuffer = thinkingBufferRef.current;
  const plannerAbortRef = useRef<AbortController | null>(null);

  useLayoutEffect(() => {
    setPendingConfirmation(null);
    setThinkingSteps([]);
    setThinkingDurationMs(null);
    setIsRequestingPlanner(false);
    return () => {
      plannerAbortRef.current?.abort();
      thinkingBuffer.dispose();
    };
  }, [pathname, thinkingBuffer]);

  useEffect(() => {
    setPhase((currentPhase) => getAgentPhaseForRoute(pathname, currentPhase));
  }, [pathname]);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  const [videoRevision, setVideoRevision] = useState(0);

  useEffect(() => {
    const handleVideosUpdated = () => {
      setVideoRevision((prev) => prev + 1);
    };
    window.addEventListener('regulation-videos-updated', handleVideosUpdated);
    return () => window.removeEventListener('regulation-videos-updated', handleVideosUpdated);
  }, []);

  const recommendedPrompt = useMemo(
    () => getRecommendedPrompt(phase),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, videoRevision],
  );
  const quickPrompts = useMemo(() => {
    if (phase === 'video_regulation' && getCurrentRegulationVideos().length === 0) {
      return ['下一步'];
    }
    const nextStepPrompt = getAgentPromptExamplesForPhase(phase).find(
      (prompt) => prompt === '下一步',
    );
    const phasePrompts = getAgentPromptExamplesForPhase(phase).filter(
      (prompt) =>
        prompt !== nextStepPrompt &&
        prompt !== recommendedPrompt &&
        (phase !== 'video_regulation' || prompt !== '播放放松视频'),
    );
    const generatedPrompts = getLocalRegulationPromptExamples(phase);

    return [
      recommendedPrompt,
      ...phasePrompts,
      ...generatedPrompts,
      ...(nextStepPrompt ? [nextStepPrompt] : []),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, recommendedPrompt, videoRevision]);

  const pushTimeline = useCallback(
    (type: AgentTimelineEntry['type'], text: string) => {
      setTimeline((entries) =>
        addAgentTimelineEntry(entries, {
          at: Date.now(),
          phase,
          text,
          type,
        }),
      );
    },
    [phase],
  );

  const flushBufferedThinking = useCallback(() => {
    thinkingBuffer.flush();
  }, [thinkingBuffer]);

  const setMessage = useCallback((text: string) => pushTimeline('planner', text), [pushTimeline]);

  const appendThinkingDelta = useCallback(
    (delta: string) => {
      thinkingBuffer.append(delta);
    },
    [thinkingBuffer],
  );

  const executeAction = useCallback(
    async (actionId: AgentActionId, params: AgentActionParams = {}) => {
      const validation = getAgentActionValidation(actionId, phase);
      if (!validation.ok) {
        setMessage(validation.reason);
        return;
      }

      pushTimeline('action', actionId);

      switch (actionId) {
        case 'open_paradigm':
        case 'open_experiment_settings': {
          const notice = await navigateTo('/experiment-settings');
          setMessage(notice ?? '已打开实验设置。请在页面确认材料与运行模式。');
          return;
        }
        case 'go_next_page': {
          const local = runWorkspaceCommand(pathname, '下一步');
          if (local !== undefined) {
            setMessage(local);
            return;
          }
          const destination = getRouteForAgentPhase(getNextAgentPhase(phase));
          const notice = await navigateTo(destination);
          setMessage(
            notice ??
              (destination === '/experiment-settings' ? '已打开实验设置。' : '已进入下一阶段。'),
          );
          return;
        }
        case 'select_video': {
          const match = findAgentVideoMatch('放松视频');
          setMessage(match.message);
          return;
        }
        case 'play_video':
          window.dispatchEvent(
            new CustomEvent('agent:play-video', {
              detail: { videoId: getPlannerStringParam(params, 'videoId') },
            }),
          );
          setMessage('已向视频页面发送播放请求。');
          return;
        case 'generate_music': {
          const plannerPrompt = getPlannerStringParam(params, 'prompt');
          const plannerDuration = getPlannerDurationParam(params);
          const plannerInstrument = getPlannerStringParam(params, 'instrument');
          const plannerStyle = getPlannerStringParam(params, 'style');
          const plannerDetails = getPlannerStringParam(params, 'details');
          const plannerTags = [plannerInstrument, plannerStyle, plannerDetails].filter(
            (tag): tag is string => Boolean(tag),
          );
          const preview = buildAgentMusicPreview({
            personalizedTags: plannerTags.length > 0 ? plannerTags : ['soft'],
          });
          if (!currentUser) {
            setMessage('请先登录后再生成调控音乐。');
            return;
          }
          window.dispatchEvent(
            new CustomEvent('agent:music-prompt', {
              detail: {
                instrument: getPlannerStringParam(params, 'instrument'),
                style: getPlannerStringParam(params, 'style'),
                details: getPlannerStringParam(params, 'details'),
                duration: plannerDuration ?? preview.params.duration,
              },
            }),
          );
          // Completion arrives via MUSIC_GENERATED_EVENT. Keep chat available
          // during generation and record submission failures in the conversation.
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
        case 'skip_game': {
          const notice = await navigateTo('/music-regulation');
          setMessage(notice ?? '已进入音乐调控。');
          return;
        }
        case 'finish_experiment': {
          const notice = await navigateTo('/home');
          if (!notice) setPhase('finish');
          setMessage(notice ?? '实验流程已完成。');
          return;
        }
        case 'go_to_phase':
        case 'cancel':
          setMessage('已取消当前操作。');
          return;
        default:
          setMessage('无法执行该操作。');
      }
    },
    [currentUser, navigateTo, pathname, phase, pushTimeline, setMessage],
  );

  const queueOrExecute = useCallback(
    async (actionId: AgentActionId, forceConfirmation = false, params: AgentActionParams = {}) => {
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
    },
    [executeAction, phase, pushTimeline, setMessage],
  );

  const requestPlannerRecommendation = useCallback(
    async (input: string) => {
      const planningStartedAt = Date.now();
      setIsRequestingPlanner(true);
      return requestAgentPlannerRecommendation(input, {
        pathname,
        personalizedAnswers,
        phase,
        abortRef: plannerAbortRef,
        timelineRef,
        plannerActionMap,
        onThinkingDelta: appendThinkingDelta,
        onStreamSettled: () => {
          setIsRequestingPlanner(false);
          if (!plannerAbortRef.current?.signal.aborted) {
            setThinkingDurationMs(Date.now() - planningStartedAt);
          }
        },
        flushThinking: flushBufferedThinking,
        queueOrExecute,
        pushTimeline,
        setMessage,
        setIsPlannerAvailable,
        setThinkingSteps,
      });
    },
    [
      appendThinkingDelta,
      flushBufferedThinking,
      pathname,
      personalizedAnswers,
      phase,
      queueOrExecute,
      pushTimeline,
      setMessage,
    ],
  );

  const submitPrompt = useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed || submittingRef.current) {
        return;
      }

      submittingRef.current = true;
      setIsPlanning(true);
      setPendingConfirmation(null);
      setThinkingDurationMs(null);
      setThinkingSteps([]);

      try {
        pushTimeline('message', trimmed);
        const workspaceReply = runWorkspaceCommand(pathname, trimmed);
        if (workspaceReply !== undefined) {
          setMessage(workspaceReply);
          return;
        }
        const localIntent = classifyAgentIntent(trimmed);
        if (isLocalFirstAction(localIntent)) {
          await queueOrExecute(localIntent);
          return;
        }

        await requestPlannerRecommendation(trimmed);
      } catch (reason) {
        setMessage(formatAgentActionError(reason));
      } finally {
        flushBufferedThinking();
        plannerAbortRef.current = null;
        setIsRequestingPlanner(false);
        submittingRef.current = false;
        setIsPlanning(false);
      }
    },
    [
      flushBufferedThinking,
      pathname,
      pushTimeline,
      queueOrExecute,
      requestPlannerRecommendation,
      setMessage,
    ],
  );

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
  }, [executeAction, pendingConfirmation, setMessage]);

  const rejectPendingAction = useCallback(() => {
    setPendingConfirmation(null);
    setMessage('已取消该操作。');
  }, [setMessage]);

  const cancelPlanning = useCallback(() => {
    if (
      !isRequestingPlanner ||
      !plannerAbortRef.current ||
      plannerAbortRef.current.signal.aborted
    ) {
      return;
    }

    plannerAbortRef.current.abort();
    thinkingBuffer.dispose();
    setThinkingSteps([]);
    setIsRequestingPlanner(false);
    setMessage('已取消本次智能助手请求。');
  }, [isRequestingPlanner, setMessage, thinkingBuffer]);

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

      const text =
        typeof detail.payload === 'string' && detail.payload.length > 0
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
    isRequestingPlanner,
    thinkingDurationMs,
    thinkingSteps,
    pendingConfirmation,
    phase,
    quickPrompts: workspacePrompts ?? quickPrompts,
    recentTimeline: timeline,
    recommendedPrompt,
    cancelPlanning,
    confirmPendingAction,
    rejectPendingAction,
    submitPrompt,
  };
}
