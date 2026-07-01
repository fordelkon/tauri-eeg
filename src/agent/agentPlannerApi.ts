import { invoke } from '@tauri-apps/api/core';
import type { MentalScaleStatus } from '../mentalScale/mentalScaleStatus';
import type { VideoRegulationAsset } from '../video/videoRegulationCatalog';
import type { AgentPersonalizedAnswer, AgentTimelineEntry } from './agentContext';
import type { AgentPhase } from './agentFlow';

export type AgentPlannerRequest = {
  phase: AgentPhase;
  currentRoute: string;
  userInput: string;
  scaleStatus: MentalScaleStatus;
  availableResources: {
    videos: Pick<VideoRegulationAsset, 'id' | 'title' | 'tags'>[];
    musicGeneration: boolean;
    gameAvailable: boolean;
  };
  personalizedContext: {
    answers: AgentPersonalizedAnswer[];
    timeline: AgentTimelineEntry[];
  };
};

export type AgentPlannerResponse = {
  status: 'available' | 'unavailable';
  action:
    | 'play_video'
    | 'recommend_video'
    | 'recommend_music'
    | 'ask_personalized_question'
    | 'generate_summary'
    | 'skip_game'
    | 'go_next_page'
    | 'no_op';
  params: Record<string, string | number | boolean | string[]>;
  reason: string;
  thinking: string[];
  requiresConfirmation: boolean;
};

export async function requestAgentPlan(request: AgentPlannerRequest): Promise<AgentPlannerResponse> {
  return invoke<AgentPlannerResponse>('plan_agent_action', { request });
}
