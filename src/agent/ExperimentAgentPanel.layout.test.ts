// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (url: URL) => readFileSync(url, 'utf8');

describe('ExperimentAgentPanel layout contract', () => {
  test('is embedded below the emotion radar without restoring the metric detail list', () => {
    const agentCss = readText(new URL('./ExperimentAgentPanel.module.css', import.meta.url));
    const mentalScaleCss = readText(new URL('../mentalScale/GlobalMentalScalePanel.module.css', import.meta.url));
    const mentalScaleTsx = readText(new URL('../mentalScale/GlobalMentalScalePanel.tsx', import.meta.url));
    const homeCss = readText(new URL('../pages/Home.module.css', import.meta.url));
    const homeTsx = readText(new URL('../pages/Home.tsx', import.meta.url));
    const shellBlock = homeTsx.match(/<div className={styles\.shell}>[\s\S]*?<\/div>\s*\n\n      {pendingScale \?/);

    expect(agentCss).not.toMatch(/position:\s*fixed/);
    expect(agentCss).not.toMatch(/\.dragHandle\s*{/s);
    expect(agentCss).toMatch(/\.panel\s*{[^}]*gap:\s*7px;/s);
    expect(agentCss).toMatch(/\.content\s*{[^}]*flex:\s*1\s+1\s+auto;/s);
    expect(agentCss).toMatch(/\.content\s*{[^}]*overflow:\s*hidden;/s);
    expect(agentCss).toMatch(/\.activity\s*{[^}]*overflow-y:\s*auto;/s);
    expect(agentCss).toMatch(/\.form\s*{[^}]*margin-top:\s*auto;/s);
    expect(agentCss).toMatch(/\.timeline\s*{[^}]*flex:\s*0\s+0\s+auto;/s);
    expect(agentCss).toMatch(/\.confirmation\s*{[^}]*gap:\s*6px;/s);
    expect(agentCss).toMatch(/\.confirmation\s*{[^}]*max-height:\s*120px;/s);
    expect(agentCss).toMatch(/\.confirmation\s*{[^}]*overflow-y:\s*auto;/s);
    expect(mentalScaleTsx).not.toContain('Highest signal');
    expect(mentalScaleTsx).not.toContain('styles.metrics');
    expect(mentalScaleTsx).toContain('{children}');
    expect(mentalScaleCss).toMatch(/\.chartWrap\s*{[^}]*flex:\s*0\s+0\s+min\(32dvh,\s*260px\);/s);
    expect(mentalScaleCss).toMatch(/\.chartWrap\s*{[^}]*min-height:\s*180px;/s);
    expect(homeCss).toMatch(/\.shell\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*3fr\)\s+minmax\(260px,\s*1fr\);/s);
    expect(homeCss).toMatch(/\.shell::before\s*{[^}]*left:\s*calc\(75%\s*\+\s*var\(--status-divider-offset\)\);/s);
    expect(shellBlock?.[0] ?? '').toContain('<GlobalMentalScalePanel>');
    expect(shellBlock?.[0] ?? '').toContain('<ExperimentAgentPanel');
    expect(readText(new URL('./ExperimentAgentPanel.tsx', import.meta.url))).toContain('className={styles.content}');
  });

  test('limits scrolling to assistant activity and confirmation content', () => {
    const agentTsx = readText(new URL('./ExperimentAgentPanel.tsx', import.meta.url));
    const agentCss = readText(new URL('./ExperimentAgentPanel.module.css', import.meta.url));
    const activityBlock = agentTsx.match(/<div className={styles\.activity}[^>]*>[\s\S]*?<\/div>\s*\n\n      <\/div>/)?.[0] ?? '';
    const contentBlock = agentTsx.match(/<div className={styles\.content}>[\s\S]*?<div className={styles\.activity}[^>]*>/)?.[0] ?? '';

    expect(agentCss).toMatch(/\.content\s*{[^}]*overflow:\s*hidden;/s);
    expect(agentCss).toMatch(/\.activity\s*{[^}]*flex:\s*1\s+1\s+auto;/s);
    expect(agentCss).toMatch(/\.activity\s*{[^}]*overflow-y:\s*auto;/s);
    expect(contentBlock).toContain('styles.promptGrid');
    expect(contentBlock).toContain('styles.thinkingPanel');
    expect(activityBlock).toContain('styles.message');
    expect(activityBlock).toContain('styles.timeline');
    expect(activityBlock).toContain('styles.confirmation');
    expect(activityBlock).not.toContain('styles.promptGrid');
    expect(activityBlock).not.toContain('styles.thinkingPanel');
  });

  test('auto-scrolls the assistant activity area to the newest message', () => {
    const agentTsx = readText(new URL('./ExperimentAgentPanel.tsx', import.meta.url));

    expect(agentTsx).toContain("import { useEffect, useRef, useState } from 'react';");
    expect(agentTsx).toContain('const activityRef = useRef<HTMLDivElement | null>(null);');
    expect(agentTsx).toContain('activity.scrollTop = activity.scrollHeight;');
    expect(agentTsx).toContain('[message, pendingConfirmation, recentTimeline]');
    expect(agentTsx).toContain('<div className={styles.activity} ref={activityRef}>');
  });

  test('surfaces assistant planning progress in the embedded chat panel', () => {
    const agentTsx = readText(new URL('./ExperimentAgentPanel.tsx', import.meta.url));
    const agentCss = readText(new URL('./ExperimentAgentPanel.module.css', import.meta.url));
    const homeTsx = readText(new URL('../pages/Home.tsx', import.meta.url));
    const hookTs = readText(new URL('./useExperimentAgent.ts', import.meta.url));

    expect(hookTs).toContain('const [isPlanning, setIsPlanning] = useState(false)');
    expect(hookTs).toContain('setIsPlanning(true)');
    expect(hookTs).toContain('setIsPlanning(false)');
    expect(hookTs).toContain('isPlanning,');
    expect(homeTsx).toContain('isPlanning={experimentAgent.isPlanning}');
    expect(agentTsx).toContain('isPlanning: boolean;');
    expect(agentTsx).toContain('isPlanning,');
    expect(agentTsx).toContain('aria-busy={isPlanning}');
    expect(agentTsx).toContain('disabled={isPlanning}');
    expect(agentTsx).toContain('styles.thinking');
    expect(agentCss).toMatch(/\.thinking\s*{/s);
    expect(agentCss).toMatch(/@keyframes\s+agentThinkingPulse/s);
  });

  test('shows planner thinking as a collapsible resizable panel', () => {
    const agentTsx = readText(new URL('./ExperimentAgentPanel.tsx', import.meta.url));
    const agentCss = readText(new URL('./ExperimentAgentPanel.module.css', import.meta.url));
    const hookTs = readText(new URL('./useExperimentAgent.ts', import.meta.url));
    const apiTs = readText(new URL('./agentPlannerApi.ts', import.meta.url));

    expect(apiTs).toContain('thinking: string[];');
    expect(hookTs).toContain('const [thinkingSteps, setThinkingSteps] = useState<string[]>([])');
    expect(hookTs).toContain('const [thinkingDurationMs, setThinkingDurationMs] = useState<number | null>(null)');
    expect(hookTs).toContain('const planningStartedAt = Date.now();');
    expect(hookTs).toContain('setThinkingDurationMs(Date.now() - planningStartedAt);');
    expect(hookTs).toContain('setThinkingSteps(response.thinking');
    expect(hookTs).toContain('thinkingSteps,');
    expect(hookTs).toContain('thinkingDurationMs,');
    expect(agentTsx).toContain('thinkingSteps: readonly string[];');
    expect(agentTsx).toContain('thinkingDurationMs: number | null;');
    expect(agentTsx).toContain('<details className={styles.thinkingPanel}');
    expect(agentTsx).toContain('Thinking...');
    expect(agentTsx).toContain('Thought for');
    expect(agentTsx).toContain('className={styles.thinkingBody}');
    expect(agentTsx).toContain('visibleThinkingSteps.map');
    expect(agentCss).toMatch(/\.thinkingPanel\s*{/s);
    expect(agentCss).toMatch(/\.thinkingBody\s*{[^}]*resize:\s*vertical;/s);
    expect(agentCss).toMatch(/\.thinkingBody\s*{[^}]*overflow:\s*auto;/s);
  });

  test('does not advance assistant phase before gated navigation actually changes route', () => {
    const hookTs = readText(new URL('./useExperimentAgent.ts', import.meta.url));

    expect(hookTs).not.toContain('setPhase(nextPhase);');
    expect(hookTs).toContain('navigateTo(getRouteForAgentPhase(nextPhase));');
  });

  test('only executes workflow and EEG control prompts before asking the planner for recommendations', () => {
    const hookTs = readText(new URL('./useExperimentAgent.ts', import.meta.url));
    const submitPromptBlock = hookTs.match(/const submitPrompt = useCallback[\s\S]*?\n  const confirmPendingAction/);
    const localFirstBlock = hookTs.match(/const localFirstActionIds = new Set<AgentActionId>\(\[[\s\S]*?\]\);/)?.[0] ?? '';

    expect(hookTs).toContain('localFirstActionIds');
    expect(localFirstBlock).toContain("'start_eeg_device_and_record'");
    expect(localFirstBlock).toContain("'stop_save_eeg_and_go_next'");
    expect(localFirstBlock).not.toContain("'play_video'");
    expect(localFirstBlock).not.toContain("'select_video'");
    expect(localFirstBlock).not.toContain("'generate_music'");
    expect(submitPromptBlock?.[0] ?? '').toContain("const localIntent = classifyAgentIntent(trimmed);");
    expect(submitPromptBlock?.[0] ?? '').toContain('isLocalFirstAction(localIntent)');
    expect(submitPromptBlock?.[0] ?? '').toContain('setIsPlannerAvailable(true);');
    expect(submitPromptBlock?.[0] ?? '').toContain('await queueOrExecute(localIntent);');
    expect(submitPromptBlock?.[0] ?? '').not.toContain('const intent = localIntent;');
    expect(submitPromptBlock?.[0] ?? '').not.toContain('await queueOrExecute(intent);');
    expect((submitPromptBlock?.[0] ?? '').indexOf('isLocalFirstAction(localIntent)'))
      .toBeLessThan((submitPromptBlock?.[0] ?? '').indexOf('requestPlannerRecommendation(trimmed)'));
  });

  test('bridges page data-agent-action clicks into the embedded assistant', () => {
    const homeTsx = readText(new URL('../pages/Home.tsx', import.meta.url));
    const videoTsx = readText(new URL('../pages/home/VideoRegulation.tsx', import.meta.url));

    expect(homeTsx).toContain("closest<HTMLElement>('[data-agent-action]')");
    expect(homeTsx).toContain('const payload = actionElement?.dataset.agentPayload;');
    expect(homeTsx).toContain('experimentAgent.submitPrompt(payload ? `${actionId}:${payload}` : actionId)');
    expect(homeTsx).toContain("actionId === 'play_video'");
    expect(videoTsx).toContain("data-agent-payload={video.id}");
  });

  test('preserves planner music parameters through confirmation into generation', () => {
    const hookTs = readText(new URL('./useExperimentAgent.ts', import.meta.url));

    expect(hookTs).toContain('params: AgentActionParams;');
    expect(hookTs).toContain('const plannerParams = normalizeAgentActionParams(response.params);');
    expect(hookTs).toContain('await queueOrExecute(actionId, response.requiresConfirmation, plannerParams);');
    expect(hookTs).toContain('params,');
    expect(hookTs).toContain('const params = pendingConfirmation.params;');
    expect(hookTs).toContain('await executeAction(actionId, params);');
    expect(hookTs).toContain("const plannerPrompt = getPlannerStringParam(params, 'prompt');");
    expect(hookTs).toContain('prompt: plannerPrompt ?? preview.params.prompt');
    expect(hookTs).toContain('duration: plannerDuration ?? preview.params.duration');
  });

  test('orders quick prompts with next step last and uses local regulation tags without planner inference', () => {
    const hookTs = readText(new URL('./useExperimentAgent.ts', import.meta.url));

    expect(hookTs).toContain('getLocalRegulationPromptExamples(phase)');
    expect(hookTs).not.toContain('setVideoPromptSuggestions');
    expect(hookTs).not.toContain('setMusicPromptSuggestions');
    expect(hookTs).not.toContain("suggest_video_prompts");
    expect(hookTs).not.toContain("suggest_music_prompts");
    expect(hookTs).not.toContain('getVideoRegulationPromptExamples');
    expect(hookTs).toContain('nextStepPrompt');
    expect(hookTs).toMatch(/\.\.\.generatedPrompts,[\s\S]*\.\.\.\(nextStepPrompt \? \[nextStepPrompt\] : \[\]\)/);
  });

  test('keeps backend video actions aligned with frontend playback', () => {
    const hookTs = readText(new URL('./useExperimentAgent.ts', import.meta.url));
    const apiTs = readText(new URL('./agentPlannerApi.ts', import.meta.url));
    const videoTsx = readText(new URL('../pages/home/VideoRegulation.tsx', import.meta.url));

    expect(apiTs).toContain("| 'play_video'");
    expect(hookTs).toContain("play_video: 'play_video'");
    expect(hookTs).toContain("new CustomEvent('agent:play-video'");
    expect(hookTs).toContain("detail: { videoId: getPlannerStringParam(params, 'videoId') }");
    expect(videoTsx).toContain("window.addEventListener('agent:play-video'");
    expect(videoTsx).toContain('const video = getAllVideoRegulationAssets(libraryAssets).find');
    expect(videoTsx).toContain('setActiveVideo(video);');
  });
});
