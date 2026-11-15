import type { MutableRefObject } from 'react';
import { getMentalScaleStatusSnapshot } from '../mentalScale/mentalScaleStatus';
import { getCurrentMusicRegulationTags } from '../music/musicRegulationTags';
import { getCurrentRegulationVideos } from '../video/regulationVideoResources';
import type { AgentActionId } from './agentActions';
import { getAgentAvailableResourcesForPhase } from './agentActions';
import { type AgentActionParams, normalizeAgentActionParams } from './agentActionParams';
import type { AgentPersonalizedAnswer, AgentTimelineEntry } from './agentContext';
import type { AgentPhase } from './agentFlow';
import type { AgentPlannerResponse } from './agentPlannerApi';
import { requestAgentPlanStream } from './agentPlannerApi';
import { classifyStepRequest } from './agentIntent';

/**
 * Planner recommendation request for the experiment agent, as a plain async
 * function: aborts the previous stream, posts the streaming plan request with
 * the phase's available resources and the agent's personalized context, and
 * routes the returned action through `queueOrExecute`. React state setters
 * and callbacks arrive via the explicit context object; the hook wraps this
 * in a `useCallback` with the same dependency list it used inline, so
 * identity/re-render behavior is unchanged.
 */

/** Planner action → agent action id mapping (unmapped planner actions are refused). */
export type AgentPlannerActionMap = Partial<Record<AgentPlannerResponse['action'], AgentActionId>>;

export type AgentPlannerRequestContext = {
  pathname: string;
  personalizedAnswers: AgentPersonalizedAnswer[];
  phase: AgentPhase;
  abortRef: MutableRefObject<AbortController | null>;
  timelineRef: MutableRefObject<AgentTimelineEntry[]>;
  plannerActionMap: AgentPlannerActionMap;
  onThinkingDelta: (delta: string) => void;
  onStreamSettled: () => void;
  flushThinking: () => void;
  queueOrExecute: (
    actionId: AgentActionId,
    forceConfirmation: boolean,
    params: AgentActionParams,
  ) => Promise<void>;
  pushTimeline: (type: AgentTimelineEntry['type'], text: string) => void;
  setMessage: (message: string) => void;
  setIsPlannerAvailable: (available: boolean) => void;
  setThinkingSteps: (steps: string[]) => void;
};

export async function requestAgentPlannerRecommendation(
  input: string,
  context: AgentPlannerRequestContext,
): Promise<void> {
  const {
    pathname,
    personalizedAnswers,
    phase,
    abortRef,
    timelineRef,
    plannerActionMap,
    onThinkingDelta,
    flushThinking,
    queueOrExecute,
    pushTimeline,
    setMessage,
    setIsPlannerAvailable,
    setThinkingSteps,
  } = context;

  abortRef.current?.abort();
  const abortController = new AbortController();
  abortRef.current = abortController;
  let receivedPlan = false;

  try {
    const videos = getCurrentRegulationVideos().map((video) => ({
      id: video.id,
      tags: [video.categoryLabel],
      title: video.title,
    }));
    const currentMusicTags = getCurrentMusicRegulationTags();
    const response = await requestAgentPlanStream(
      {
        availableResources: getAgentAvailableResourcesForPhase(phase, videos),
        currentRoute: pathname,
        personalizedContext: {
          answers:
            currentMusicTags.length > 0
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
          timeline: timelineRef.current,
        },
        phase,
        scaleStatus: getMentalScaleStatusSnapshot(),
        userInput: input,
      },
      { onThinkingDelta, signal: abortController.signal },
    ).finally(context.onStreamSettled);

    if (abortController.signal.aborted) {
      return;
    }

    receivedPlan = true;
    flushThinking();

    if (response.status === 'unavailable') {
      setIsPlannerAvailable(false);
      setThinkingSteps(response.thinking ?? []);
      setMessage('推荐服务暂不可用。你仍可使用本地快捷指令，或在当前页面手动操作。');
      return;
    }

    setIsPlannerAvailable(true);
    setThinkingSteps(response.thinking ?? []);
    if (
      response.action === 'generate_summary' ||
      response.action === 'ask_personalized_question' ||
      response.action === 'no_op'
    ) {
      setMessage(response.reason);
      return;
    }

    const actionId = plannerActionMap[response.action];
    if (actionId === 'go_next_page' && classifyStepRequest(input) !== 'advance') {
      setMessage('已停留在当前步骤。要继续，请选择对应的快捷指令。');
      return;
    }
    if (!actionId) {
      setMessage('智能助手返回了不可执行操作，已拒绝。');
      return;
    }

    setMessage(response.reason);
    if (
      (response.action === 'play_video' || response.action === 'recommend_video') &&
      typeof response.params.videoId === 'string'
    ) {
      pushTimeline('planner', `recommend_video:${response.params.videoId}`);
    }
    if (response.action === 'recommend_music') {
      const style = typeof response.params.style === 'string' ? response.params.style : '';
      const details = typeof response.params.details === 'string' ? response.params.details : '';
      pushTimeline('planner', `recommend_music:${style}|${details}`);
    }
    const plannerParams = normalizeAgentActionParams(response.params);
    await queueOrExecute(actionId, response.requiresConfirmation, plannerParams);
  } catch (error) {
    // Superseded by a newer request (abortRef moved on) or explicitly aborted:
    // both are intentional stops, not planner failures, so keep the assistant
    // marked available.
    if (abortController.signal.aborted || abortRef.current !== abortController) {
      return;
    }

    if (receivedPlan) throw error;
    setIsPlannerAvailable(false);
    setMessage('无法连接推荐服务。你仍可使用本地快捷指令，或稍后重新发送。');
  }
}
