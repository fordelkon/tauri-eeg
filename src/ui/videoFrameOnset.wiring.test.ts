// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (url: URL) => readFileSync(url, 'utf8');

/**
 * Wiring contract for the first-presented-frame onset mark
 * (docs/biosemi-trigger-implementation.md §7.1): every video that sends a
 * start code arms the frame observation on first `playing`, the execution
 * layers map the onset into the event `source` and `details`, and the legacy
 * playing-only one-shot refs are gone rather than stacked beside the hook.
 */
describe('first presented frame onset wiring', () => {
  test('all three video players arm the frame onset on first playing', () => {
    const induction = readText(new URL('../pages/home/EffectFullscreenInduction.tsx', import.meta.url));
    const regulation = readText(
      new URL('../pages/home/EffectFullscreenVideoRegulation.tsx', import.meta.url),
    );
    const trialStage = readText(new URL('../paradigm/TrialStageRenderer.tsx', import.meta.url));
    for (const source of [induction, regulation, trialStage]) {
      expect(source).toContain('useFirstVideoFrameOnset');
      expect(source).toContain('handleFirstPlaying(event.currentTarget)');
    }
    expect(induction).toContain('onPlaying: (onset: VideoOnsetInfo) => void');
    expect(regulation).toContain('onset,');
    expect(trialStage).toContain('onVideoFirstPlay: (onset: VideoOnsetInfo) => void');
    expect(induction).not.toContain('onsetRef.current');
    expect(regulation).not.toContain('onsetRef.current');
    expect(trialStage).not.toContain('firstPlayRef.current');
  });

  test('the induction panel forwards the onset into the flow', () => {
    const panels = readText(new URL('../pages/home/EffectStepPanels.tsx', import.meta.url));
    expect(panels).toContain('flow.inductionOnset(status.entry.videoId, onset)');
  });

  test('the effect execution derives the event source from the onset details', () => {
    const execution = readText(new URL('../pages/home/effectEvaluationExecution.ts', import.meta.url));
    expect(execution).toContain('onsetSourceFromDetails(details)');
    expect(execution).toContain('videoOnsetEventSource(onset)');
    expect(execution).toContain('inductionOnset = (mediaId: string, onset?: VideoOnsetInfo)');
  });

  test('the paradigm execution forwards the onset source and details', () => {
    const execution = readText(new URL('../paradigm/paradigmExecution.ts', import.meta.url));
    const experiment = readText(new URL('../paradigm/paradigmExperiment.ts', import.meta.url));
    const hook = readText(new URL('../paradigm/useIndependentParadigmRun.ts', import.meta.url));
    expect(execution).toContain('videoOnsetEventSource(onset)');
    expect(experiment).toContain('details?: unknown');
    expect(hook).toContain('videoFirstPlay(state, onset)');
  });
});
