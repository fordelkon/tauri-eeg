import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentPlannerRequest, AgentPlannerResponse } from './agentPlannerApi';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const plannerResponse: AgentPlannerResponse = {
  status: 'available',
  action: 'no_op',
  params: {},
  reason: 'ok',
  thinking: [],
  requiresConfirmation: false,
};

const sampleRequest: AgentPlannerRequest = {
  availableResources: { gameAvailable: false, musicGeneration: false, videos: [] },
  currentRoute: '/home',
  personalizedContext: { answers: [], timeline: [] },
  phase: 'intro',
  scaleStatus: { dimensions: [], lastScaleTitle: '', updatedAt: null },
  userInput: '开始实验',
};

/** Minimal ok response whose body streams the given raw SSE events. */
function sseResponse(events: string[]) {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async (): Promise<{ done: boolean; value: Uint8Array | undefined }> => (
          index < events.length
            ? { done: false, value: encoder.encode(events[index++]) }
            : { done: true, value: undefined }
        ),
      }),
    },
  };
}

function responseEvent(response: AgentPlannerResponse): string {
  return `event: response\ndata: ${JSON.stringify(response)}\n\n`;
}

// The base-URL cache lives in module scope, so each test re-imports the
// module under test through a reset registry to start from a cold cache.
async function loadModule() {
  return await import('./agentPlannerApi');
}

describe('requestAgentPlanStream base-URL cache', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves the planner base URL once and reuses it for subsequent requests', async () => {
    vi.mocked(invoke).mockResolvedValue('http://127.0.0.1:8722');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse([responseEvent(plannerResponse)]))
      .mockResolvedValueOnce(sseResponse([responseEvent(plannerResponse)]));
    vi.stubGlobal('fetch', fetchMock);

    const { requestAgentPlanStream } = await loadModule();

    await expect(requestAgentPlanStream(sampleRequest)).resolves.toMatchObject({ action: 'no_op' });
    await expect(requestAgentPlanStream(sampleRequest)).resolves.toMatchObject({ action: 'no_op' });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('get_agent_service_base_url');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8722/agent/plan/stream');
  });

  it('re-resolves the base URL after a connection-refused fetch failure', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce('http://127.0.0.1:8722')
      .mockResolvedValueOnce('http://127.0.0.1:9901');
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(sseResponse([responseEvent(plannerResponse)]));
    vi.stubGlobal('fetch', fetchMock);

    const { requestAgentPlanStream } = await loadModule();

    await expect(requestAgentPlanStream(sampleRequest)).rejects.toThrow(TypeError);
    await expect(requestAgentPlanStream(sampleRequest)).resolves.toMatchObject({ action: 'no_op' });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:9901/agent/plan/stream');
  });

  it('keeps the cached base URL when a request is merely aborted', async () => {
    vi.mocked(invoke).mockResolvedValue('http://127.0.0.1:8722');
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'))
      .mockResolvedValueOnce(sseResponse([responseEvent(plannerResponse)]));
    vi.stubGlobal('fetch', fetchMock);

    const { requestAgentPlanStream } = await loadModule();

    await expect(requestAgentPlanStream(sampleRequest)).rejects.toThrow();
    await expect(requestAgentPlanStream(sampleRequest)).resolves.toMatchObject({ action: 'no_op' });

    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
