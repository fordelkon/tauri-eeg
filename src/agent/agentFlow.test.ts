import { describe, expect, it } from 'vitest';
import {
  agentPromptExamples,
  getAgentPromptExamplesForPhase,
  getAgentPhaseForRoute,
  getLocalRegulationPromptExamples,
  getNextAgentPhase,
  getRecommendedPrompt,
  getRouteForAgentPhase,
  isAgentPhase,
} from './agentFlow';

describe('agentFlow', () => {
  it('maps current routes to assistant phases without adding new EEG routes', () => {
    expect(getAgentPhaseForRoute('/home')).toBe('intro');
    expect(getAgentPhaseForRoute('/eeg-acquisition')).toBe('baseline');
    expect(getAgentPhaseForRoute('/video-regulation')).toBe('video_regulation');
    expect(getAgentPhaseForRoute('/game-regulation')).toBe('game_regulation');
    expect(getAgentPhaseForRoute('/music-regulation')).toBe('music_regulation');
    expect(getAgentPhaseForRoute('/eeg-acquisition', 'music_regulation')).toBe('recovery');
  });

  it('maps baseline and recovery to the existing EEG route', () => {
    expect(getRouteForAgentPhase('baseline')).toBe('/eeg-acquisition');
    expect(getRouteForAgentPhase('recovery')).toBe('/eeg-acquisition');
  });

  it('keeps finish when recovery returns to the home route', () => {
    expect(getAgentPhaseForRoute('/home', 'recovery')).toBe('finish');
  });

  it('advances through the fixed paradigm', () => {
    expect(getNextAgentPhase('intro')).toBe('baseline');
    expect(getNextAgentPhase('baseline')).toBe('video_regulation');
    expect(getNextAgentPhase('video_regulation')).toBe('game_regulation');
    expect(getNextAgentPhase('game_regulation')).toBe('music_regulation');
    expect(getNextAgentPhase('music_regulation')).toBe('recovery');
    expect(getNextAgentPhase('recovery')).toBe('finish');
    expect(getNextAgentPhase('finish')).toBe('finish');
  });

  it('exposes subject-friendly prompt examples and recommended prompts', () => {
    expect(agentPromptExamples).toContain('开始实验');
    expect(agentPromptExamples).toContain('结束并保存数据');
    expect(getRecommendedPrompt('baseline')).toBe('开始基线采集');
    expect(getRecommendedPrompt('game_regulation')).toBe('跳过当前不可用环节');
  });

  it('validates phase strings at boundaries', () => {
    expect(isAgentPhase('baseline')).toBe(true);
    expect(isAgentPhase('unknown')).toBe(false);
  });

  it('keeps quick prompts scoped to the current phase while preserving next step', () => {
    const nextStepPrompt = agentPromptExamples[1];
    const videoPrompt = agentPromptExamples[3];
    const musicPrompt = agentPromptExamples[4];
    const videoPrompts = getAgentPromptExamplesForPhase('video_regulation');
    const musicPrompts = getAgentPromptExamplesForPhase('music_regulation');

    expect(videoPrompts).toContain(nextStepPrompt);
    expect(videoPrompts).toContain(videoPrompt);
    expect(videoPrompts).not.toContain(musicPrompt);
    expect(musicPrompts).toContain(nextStepPrompt);
    expect(musicPrompts).toContain(musicPrompt);
    expect(musicPrompts).not.toContain(videoPrompt);
  });

  it('keeps video prompt examples limited to generic controls', () => {
    expect(getAgentPromptExamplesForPhase('video_regulation')).toEqual([
      agentPromptExamples[1],
      agentPromptExamples[3],
    ]);
  });

  it('randomly selects two local regulation tags for fast quick prompts', () => {
    const randomValues = [0.51, 0.7, 0.57, 0.82];
    const nextRandom = () => randomValues.shift() ?? 0;

    expect(getLocalRegulationPromptExamples('video_regulation', nextRandom)).toEqual([
      '播放低落提振视频',
      '播放睡前安定视频',
    ]);
    expect(getLocalRegulationPromptExamples('music_regulation', nextRandom)).toEqual([
      '生成压力释放音乐',
      '生成情绪稳定音乐',
    ]);
    expect(getLocalRegulationPromptExamples('baseline')).toEqual([]);
  });
});
