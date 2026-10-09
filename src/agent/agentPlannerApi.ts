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
  signal?: AbortSignal;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    // SSE tolerates dropped events: a malformed data line is skipped instead
    // of killing a stream that may already have produced valid output.
    return null;
  }

  if (eventName === 'thinking_delta') {
    const delta = isRecord(payload) && typeof payload.delta === 'string' ? payload.delta : '';
    if (delta) {
      options.onThinkingDelta?.(delta);
    }
    return null;
  }
  if (eventName === 'error') {
    const message = isRecord(payload) && typeof payload.error === 'string' && payload.error
      ? payload.error
      : 'Agent planner stream failed.';
    throw new Error(message);
  }
  if (eventName === 'response') {
    // Minimal shape guard before the cast: unknown actions and params are
    // narrowed downstream, but status/action must at least be strings.
    if (isRecord(payload) && typeof payload.status === 'string' && typeof payload.action === 'string') {
      return payload as AgentPlannerResponse;
    }
    return null;
  }

  return null;
}

/**
 * The Tauri command re-resolves the planner service URL on every call; cache
 * it in module scope so each streamed plan skips that round trip. A refused
 * connection — the typical symptom of a service that moved to a new port —
 * drops the cache so the next request re-resolves instead of retrying a
 * stale URL forever.
 */
let cachedAgentServiceBaseUrl: string | null = null;

async function resolveAgentServiceBaseUrl(): Promise<string> {
  if (cachedAgentServiceBaseUrl === null) {
    cachedAgentServiceBaseUrl = await invoke<string>('get_agent_service_base_url');
  }

  return cachedAgentServiceBaseUrl;
}

export async function requestAgentPlanStream(
  request: AgentPlannerRequest,
  options: AgentPlanStreamOptions = {},
): Promise<AgentPlannerResponse> {
  const baseUrl = await resolveAgentServiceBaseUrl();

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/agent/plan/stream`, {
      body: JSON.stringify(request),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: options.signal,
    });
  } catch (error) {
    // fetch surfaces network failures (connection refused, service gone) as
    // TypeError; an AbortError DOMException is a deliberate cancel and says
    // nothing about the URL, so it must keep the cache warm.
    if (error instanceof TypeError) {
      cachedAgentServiceBaseUrl = null;
    }

    throw error;
  }

  if (!response.ok || !response.body) {
    throw new Error(`Agent planner service returned HTTP ${response.status}.`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let streamDone = false;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (options.signal?.aborted) {
        throw new DOMException('Agent planner stream aborted.', 'AbortError');
      }

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
        streamDone = true;
        break;
      }
    }

    if (buffer.trim()) {
      const plannerResponse = readStreamEvent(buffer, options);
      if (plannerResponse) {
        return plannerResponse;
      }
    }
  } finally {
    // Every exit short of a clean end-of-stream (early return, parse error,
    // abort) must release the body lock; the connection otherwise stays open
    // until GC.
    if (!streamDone) {
      void reader.cancel().catch(() => undefined);
    }
  }

  throw new Error('Agent planner stream ended without a response.');
}
