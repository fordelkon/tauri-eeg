import { describe, expect, it } from 'vitest';
import {
  getMentalScaleForPath,
  isMentalScaleComplete,
  mentalScaleAnswerOptions,
  mentalScaleDefinitions,
} from './mentalScaleGate';
import { PHQ4_SCALE_ID } from './instruments/phq4';

describe('mentalScaleGate', () => {
  it('gates every regulation page with the shared PHQ-4 screening instrument', () => {
    for (const path of ['/video-regulation', '/game-regulation', '/music-regulation'] as const) {
      const scale = getMentalScaleForPath(path);
      expect(scale).not.toBeNull();
      // One shared instrument (doc scale-instruments.md §2.1): same scale_id,
      // title, and 4 PHQ-4 items on every gated path.
      expect(scale?.scaleId).toBe(PHQ4_SCALE_ID);
      expect(scale?.title).toBe('心理健康筛查（PHQ-4）');
      expect(scale?.questions).toHaveLength(4);
    }

    expect(getMentalScaleForPath('/eeg-acquisition')).toBeNull();
    expect(getMentalScaleForPath('/home')).toBeNull();
  });

  it('keeps the per-path gate identity while sharing the instrument content', () => {
    // Completion/skip bookkeeping stays keyed per route; only the questions
    // are shared.
    expect(mentalScaleDefinitions['/video-regulation'].path).toBe('/video-regulation');
    expect(mentalScaleDefinitions['/game-regulation'].path).toBe('/game-regulation');
    expect(mentalScaleDefinitions['/music-regulation'].path).toBe('/music-regulation');

    const [video, game, music] = Object.values(mentalScaleDefinitions);
    expect(video.questions).toEqual(game.questions);
    expect(game.questions).toEqual(music.questions);
  });

  it('uses the PHQ-4 0-3 frequency anchors verbatim (doc §2.1)', () => {
    expect(mentalScaleAnswerOptions).toEqual([
      { value: 0, label: '完全不会' },
      { value: 1, label: '好几天' },
      { value: 2, label: '一半以上的天数' },
      { value: 3, label: '几乎每天' },
    ]);
  });

  it('carries the past-two-weeks instruction and a non-diagnostic screening note', () => {
    const scale = getMentalScaleForPath('/video-regulation')!;
    expect(scale.subtitle).toBe('在过去两周里，以下问题困扰你的频繁程度？');
    expect(scale.screening?.threshold).toBe(3);
    expect(scale.screening?.message).toContain('建议进一步评估');
    // The note must never read as a diagnosis.
    expect(scale.screening?.message).toContain('不构成诊断');
  });

  it('requires every question in a scale to be answered before continuing', () => {
    const scale = getMentalScaleForPath('/music-regulation')!;

    expect(isMentalScaleComplete(scale, {})).toBe(false);
    expect(isMentalScaleComplete(scale, {
      [scale.questions[0].id]: 0,
      [scale.questions[1].id]: 1,
      [scale.questions[2].id]: 2,
    })).toBe(false);
    expect(isMentalScaleComplete(scale, {
      [scale.questions[0].id]: 0,
      [scale.questions[1].id]: 1,
      [scale.questions[2].id]: 2,
      [scale.questions[3].id]: 3,
    })).toBe(true);
  });
});
