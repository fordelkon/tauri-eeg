import { describe, expect, it } from 'vitest';
import {
  getMentalScaleForPath,
  isMentalScaleComplete,
  mentalScaleAnswerOptions,
  mentalScaleDefinitions,
} from './mentalScaleGate';

describe('mentalScaleGate', () => {
  it('defines anxiety and depression scale gates for regulation pages only', () => {
    expect(getMentalScaleForPath('/video-regulation')?.title).toBe('视频调控量表');
    expect(getMentalScaleForPath('/game-regulation')?.title).toBe('游戏调控量表');
    expect(getMentalScaleForPath('/music-regulation')?.title).toBe('音乐调控量表');
    expect(getMentalScaleForPath('/eeg-acquisition')).toBeNull();
    expect(getMentalScaleForPath('/home')).toBeNull();
  });

  it('keeps each regulation scale short and focused on anxiety or depression', () => {
    const keywordPattern = /焦虑|担忧|紧张|烦躁|放松|低落|沮丧|无望|兴趣|精力|自责|睡/;

    expect(mentalScaleAnswerOptions).toEqual([
      { value: 0, label: '从不' },
      { value: 1, label: '偶尔' },
      { value: 2, label: '经常' },
      { value: 3, label: '几乎每天' },
    ]);

    for (const definition of Object.values(mentalScaleDefinitions)) {
      expect(definition.questions.length).toBeGreaterThanOrEqual(2);
      expect(definition.questions.length).toBeLessThanOrEqual(3);
      expect(definition.questions.every((question) => keywordPattern.test(question.prompt))).toBe(true);
    }
  });

  it('requires every question in a scale to be answered before continuing', () => {
    const scale = mentalScaleDefinitions['/music-regulation'];

    expect(isMentalScaleComplete(scale, {})).toBe(false);
    expect(isMentalScaleComplete(scale, {
      [scale.questions[0].id]: 0,
      [scale.questions[1].id]: 1,
    })).toBe(false);
    expect(isMentalScaleComplete(scale, {
      [scale.questions[0].id]: 0,
      [scale.questions[1].id]: 1,
      [scale.questions[2].id]: 3,
    })).toBe(true);
  });
});
