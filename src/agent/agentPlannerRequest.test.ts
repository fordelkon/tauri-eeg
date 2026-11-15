import { expect, it, vi } from 'vitest';
import { requestAgentPlanStream } from './agentPlannerApi';
import { requestAgentPlannerRecommendation } from './agentPlannerRequest';

vi.mock('./agentPlannerApi', () => ({ requestAgentPlanStream: vi.fn() }));

it('keeps the current step when a planner interprets an unrelated message as navigation', async () => {
  vi.mocked(requestAgentPlanStream).mockResolvedValue({
    status: 'available',
    action: 'go_next_page',
    reason: '继续',
    params: {},
    requiresConfirmation: false,
    thinking: [],
  });
  const queueOrExecute = vi.fn();
  const setMessage = vi.fn();
  await requestAgentPlannerRecommendation('今天心情很好', {
    pathname: '/experiment-settings',
    phase: 'baseline',
    personalizedAnswers: [],
    abortRef: { current: null },
    timelineRef: { current: [] },
    plannerActionMap: { go_next_page: 'go_next_page' },
    onThinkingDelta: vi.fn(),
    onStreamSettled: vi.fn(),
    flushThinking: vi.fn(),
    queueOrExecute,
    pushTimeline: vi.fn(),
    setMessage,
    setIsPlannerAvailable: vi.fn(),
    setThinkingSteps: vi.fn(),
  });
  expect(queueOrExecute).not.toHaveBeenCalled();
  expect(setMessage).toHaveBeenCalledWith(expect.stringContaining('快捷指令'));
});
