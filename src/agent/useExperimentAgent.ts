import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useEegSession } from '../eeg/EegSessionContext';
import { getMentalScaleStatusSnapshot } from '../mentalScale/mentalScaleStatus';
import { generateMusic } from '../music/musicGenerationApi';
import { getCurrentMusicRegulationTags } from '../music/musicRegulationTags';
import { getAllVideoRegulationAssets } from '../video/videoRegulationCatalog';
import {
  type AgentActionId,
  getAgentAction,
  getAgentAvailableResourcesForPhase,
  getAgentActionValidation,
} from './agentActions';
import {
  addAgentTimelineEntry,
  type AgentPersonalizedAnswer,
  type AgentTimelineEntry,
} from './agentContext';
import { classifyAgentIntent } from './agentIntent';
import { buildAgentMusicPreview } from './agentMusic';
import { requestAgentPlan } from './agentPlannerApi';
import { findAgentVideoMatch } from './agentVideo';
import {
  type AgentPhase,
  getAgentPromptExamplesForPhase,
  getAgentPhaseForRoute,
  getNextAgentPhase,
  getRecommendedPrompt,
  getRouteForAgentPhase,
} from './agentFlow';

export type PendingAgentConfirmation = {
  actionId: AgentActionId;
  label: string;
  params: AgentActionParams;
};

type AgentActionParamValue = string | number | boolean | string[];
type AgentActionParams = Record<string, AgentActionParamValue>;

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
} as const satisfies Partial<Record<string, AgentActionId>>;

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

function normalizeAgentActionParams(params: Record<string, AgentActionParamValue> | undefined): AgentActionParams {
  return params ?? {};
}

function getPlannerStringParam(params: AgentActionParams, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getPlannerDurationParam(params: AgentActionParams): number | null {
  const value = params.duration;
  return typeof value === 'number' && Number.isFinite(value) && value >= 5 && value <= 120 ? value : null;
}

export function useExperimentAgent({ pathname, navigateTo }: UseExperimentAgentOptions) {
  const eeg = useEegSession();
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

  useEffect(() => {
    setPhase((currentPhase) => getAgentPhaseForRoute(pathname, currentPhase));
  }, [pathname]);

  const recommendedPrompt = useMemo(() => getRecommendedPrompt(phase), [phase]);
  const quickPrompts = useMemo(() => [
    recommendedPrompt,
    ...getAgentPromptExamplesForPhase(phase),
  ], [phase, recommendedPrompt]);

  const pushTimeline = useCallback((type: AgentTimelineEntry['type'], text: string) => {
    setTimeline((entries) => addAgentTimelineEntry(entries, {
      at: Date.now(),
      phase,
      text,
      type,
    }));
  }, [phase]);

  const executeAction = useCallback(async (actionId: AgentActionId, params: AgentActionParams = {}) => {
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
      case 'start_eeg_device':
        await eeg.startDevice();
        setMessage('已请求启动 EEG 设备。');
        return;
      case 'stop_eeg_device':
        await eeg.stopDevice();
        setMessage('已请求停止 EEG 设备。');
        return;
      case 'start_eeg_recording':
        await eeg.startRecord();
        setMessage(phase === 'recovery' ? '已请求开始恢复采集。' : '已请求开始基线采集。');
        return;
      case 'pause_eeg_recording':
        eeg.pauseRecord();
        setMessage('已暂停 EEG 采集。');
        return;
      case 'resume_eeg_recording':
        eeg.resumeRecord();
        setMessage('已继续 EEG 采集。');
        return;
      case 'stop_and_save_eeg_recording':
        await eeg.stopRecord();
        setMessage('已请求停止并保存 EEG 数据。');
        return;
      case 'start_eeg_device_and_record':
        await eeg.startDevice();
        await eeg.startRecord();
        setMessage(phase === 'recovery' ? '已启动设备并开始恢复采集。' : '已启动设备并开始基线采集。');
        return;
      case 'stop_save_eeg_and_go_next': {
        await eeg.stopRecord();
        const nextPhase = getNextAgentPhase(phase);
        navigateTo(getRouteForAgentPhase(nextPhase));
        setMessage(`已停止并保存 EEG 数据，进入：${getRecommendedPrompt(nextPhase)}`);
        return;
      }
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
        const plannerTags = [
          getPlannerStringParam(params, 'style'),
          getPlannerStringParam(params, 'details'),
        ].filter((tag): tag is string => Boolean(tag));
        const preview = buildAgentMusicPreview({ coreScores: scores, personalizedTags: plannerTags.length > 0 ? plannerTags : ['soft'] });
        if (!currentUser) {
          setMessage('请先登录后再生成调控音乐。');
          return;
        }
        await generateMusic({
          duration: plannerDuration ?? preview.params.duration,
          prompt: plannerPrompt ?? preview.params.prompt,
          userId: currentUser.id,
          username: currentUser.username,
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
  }, [currentUser, eeg, navigateTo, phase, pushTimeline]);

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
    try {
      const videos = getAllVideoRegulationAssets().map((video) => ({
        id: video.id,
        tags: video.tags,
        title: video.title,
      }));
      const currentMusicTags = getCurrentMusicRegulationTags();
      const response = await requestAgentPlan({
        availableResources: getAgentAvailableResourcesForPhase(phase, videos),
        currentRoute: pathname,
        personalizedContext: {
          answers: currentMusicTags.length > 0
            ? [
              ...personalizedAnswers,
              {
                answer: currentMusicTags.join(', '),
                createdAt: Date.now(),
                normalizedTags: currentMusicTags,
                phase: 'music_regulation' as const,
              },
            ]
            : personalizedAnswers,
          timeline,
        },
        phase,
        scaleStatus: getMentalScaleStatusSnapshot(),
        userInput: input,
      });

      if (response.status === 'unavailable') {
        setIsPlannerAvailable(false);
        setThinkingSteps(response.thinking ?? []);
        setMessage('智能助手暂不可用，请使用页面手动操作。');
        return false;
      }

      setIsPlannerAvailable(true);
      setThinkingSteps(response.thinking ?? []);
      if (response.action === 'generate_summary' || response.action === 'ask_personalized_question' || response.action === 'no_op') {
        setMessage(response.reason);
        pushTimeline('planner', response.reason);
        return true;
      }

      const actionId = plannerActionMap[response.action];
      if (!actionId) {
        setMessage('智能助手返回了不可执行操作，已拒绝。');
        return true;
      }

      setMessage(response.reason);
      if ((response.action === 'play_video' || response.action === 'recommend_video') && typeof response.params.videoId === 'string') {
        pushTimeline('planner', `recommend_video:${response.params.videoId}`);
      }
      if (response.action === 'recommend_music') {
        const style = typeof response.params.style === 'string' ? response.params.style : '';
        const details = typeof response.params.details === 'string' ? response.params.details : '';
        pushTimeline('planner', `recommend_music:${style}|${details}`);
      }
      const plannerParams = normalizeAgentActionParams(response.params);
      await queueOrExecute(actionId, response.requiresConfirmation, plannerParams);
      return true;
    } catch {
      setIsPlannerAvailable(false);
      setMessage('智能助手暂不可用，已切换为本地指令识别。');
      return false;
    }
  }, [pathname, personalizedAnswers, phase, queueOrExecute, pushTimeline, timeline]);

  const submitPrompt = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed || isPlanning) {
      return;
    }

    setIsPlanning(true);
    setThinkingDurationMs(null);
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
      return;
    }
    } finally {
      setThinkingDurationMs(Date.now() - planningStartedAt);
      setIsPlanning(false);
    }
  }, [isPlanning, pushTimeline, queueOrExecute, requestPlannerRecommendation]);

  const confirmPendingAction = useCallback(async () => {
    if (!pendingConfirmation) {
      return;
    }

    const actionId = pendingConfirmation.actionId;
    const params = pendingConfirmation.params;
    setPendingConfirmation(null);
    await executeAction(actionId, params);
  }, [executeAction, pendingConfirmation]);

  const rejectPendingAction = useCallback(() => {
    setPendingConfirmation(null);
    setMessage('已取消敏感操作。');
  }, []);

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
    confirmPendingAction,
    rejectPendingAction,
    submitPrompt,
  };
}
