import type { MutableRefObject } from 'react';
import { getMentalScaleStatusSnapshot } from '../mentalScale/mentalScaleStatus';
import { getCurrentMusicRegulationTags } from '../music/musicRegulationTags';
import { getAllVideoRegulationAssets } from '../video/videoRegulationCatalog';
import type { AgentActionId } from './agentActions';
import { getAgentAvailableResourcesForPhase } from './agentActions';
import {
  type AgentActionParams,
  normalizeAgentActionParams,
} from './agentActionParams';
import type { AgentPersonalizedAnswer, AgentTimelineEntry } from './agentContext';
import type { AgentPhase } from './agentFlow';
import type { AgentPlannerResponse } from './agentPlannerApi';
import { requestAgentPlanStream } from './agentPlannerApi';

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
  flushThinking: () => void;
  queueOrExecute: (actionId: AgentActionId, forceConfirmation: boolean, params: AgentActionParams) => Promise<void>;
  pushTimeline: (type: AgentTimelineEntry['type'], text: string) => void;
  setMessage: (message: string) => void;
  setIsPlannerAvailable: (available: boolean) => void;
  setThinkingSteps: (steps: string[]) => void;
};

export async function requestAgentPlannerRecommendation(
  input: string,
  context: AgentPlannerRequestContext,
): Promise<boolean> {
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

  try {
    const videos = getAllVideoRegulationAssets().map((video) => ({
      id: video.id,
      tags: video.tags,
      title: video.title,
    }));
    const currentMusicTags = getCurrentMusicRegulationTags();
    const response = await requestAgentPlanStream(
      {
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
          timeline: timelineRef.current,
        },
        phase,
        scaleStatus: getMentalScaleStatusSnapshot(),
        userInput: input,
      },
      { onThinkingDelta, signal: abortController.signal },
    );

    if (abortController.signal.aborted) {
      return true;
    }

    flushThinking();

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
  } catch (reason) {
    if (abortRef.current?.signal.aborted) {
      return true;
    }

    setIsPlannerAvailable(false);
    setMessage('智能助手暂不可用，已切换为本地指令识别。');
    return false;
  }
}
