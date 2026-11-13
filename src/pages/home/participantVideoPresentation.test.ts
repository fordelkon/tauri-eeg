import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createEffectEvaluationFlowState } from './effectEvaluationFlow';
import { EffectFullscreenInduction } from './EffectFullscreenInduction';
import { EffectFullscreenVideoRegulation } from './EffectFullscreenVideoRegulation';

// Leave the stimulus children intact; the native document portal is unavailable in SSR.
vi.mock('./ParticipantVideoStage', () => ({
  ParticipantVideoStage: ({ children }: { children: ReactNode }) => children,
}));

const clip = {
  videoId: 'clip',
  absolutePath: '/videos/target-emotion.mp4',
  fileName: 'target-emotion.mp4',
};
const noop = () => {};
const textOf = (html: string) => html.replace(/<[^>]+>/g, '').trim();

describe('active participant video', () => {
  it('renders only video in both induction and timed regulation, including rehearsal', () => {
    const induction = renderToStaticMarkup(
      createElement(EffectFullscreenInduction, {
        entry: clip,
        isPlaying: true,
        rehearsal: true,
        isStarting: false,
        retryCount: 0,
        startError: null,
        interrupted: false,
        onFinished: noop,
        onExit: noop,
        onReset: noop,
        onTestSkip: noop,
        onError: noop,
        onPlaying: noop,
        onStartPlayback: noop,
      }),
    );
    const regulation = renderToStaticMarkup(
      createElement(EffectFullscreenVideoRegulation, {
        assets: [clip],
        finishMode: { mode: 'requires-skip', remainingSeconds: 20 },
        interrupted: false,
        isPlaying: true,
        onStartPlayback: noop,
        onReset: noop,
        onFinish: noop,
        onSkip: noop,
        onError: noop,
        onPlaying: noop,
        onExit: noop,
        onWindowElapsed: noop,
        windowNoun: '调控',
        state: { ...createEffectEvaluationFlowState(), step: 3, regulationStartedAtMs: Date.now() },
      }),
    );
    for (const html of [induction, regulation]) {
      expect(html).toContain('<video');
      expect(textOf(html)).toBe('');
      expect(html).not.toMatch(/<button|\bcontrols(?:=|\s|>)/);
    }
  });
});
