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

type AgentPlanStreamOptions = {
  onThinkingDelta?: (delta: string) => void;
};

function parseSseEvent(rawEvent: string): { eventName: string; data: string } | null {
  const lines = rawEvent.split(/\r?\n/);
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return { eventName, data: dataLines.join('\n') };
}

function readStreamEvent(
  rawEvent: string,
  options: AgentPlanStreamOptions,
): AgentPlannerResponse | null {
  const parsedEvent = parseSseEvent(rawEvent);
  if (!parsedEvent) {
    return null;
  }

  const { data, eventName } = parsedEvent;
  const payload = JSON.parse(data) as { delta?: string; error?: string } | AgentPlannerResponse;
  if (eventName === 'thinking_delta') {
    const delta = 'delta' in payload && typeof payload.delta === 'string' ? payload.delta : '';
    if (delta) {
      options.onThinkingDelta?.(delta);
    }
    return null;
  }
  if (eventName === 'error') {
    throw new Error('error' in payload && payload.error ? payload.error : 'Agent planner stream failed.');
  }
  if (eventName === 'response') {
    return payload as AgentPlannerResponse;
  }

  return null;
}

export async function requestAgentPlanStream(
  request: AgentPlannerRequest,
  options: AgentPlanStreamOptions = {},
): Promise<AgentPlannerResponse> {
  const baseUrl = await invoke<string>('get_agent_service_base_url');
  const response = await fetch(`${baseUrl}/agent/plan/stream`, {
    body: JSON.stringify(request),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

  if (!response.ok || !response.body) {
    throw new Error(`Agent planner service returned HTTP ${response.status}.`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? '';

    for (const rawEvent of events) {
      const plannerResponse = readStreamEvent(rawEvent, options);
      if (plannerResponse) {
        return plannerResponse;
      }
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    const plannerResponse = readStreamEvent(buffer, options);
    if (plannerResponse) {
      return plannerResponse;
    }
  }

  throw new Error('Agent planner stream ended without a response.');
}
