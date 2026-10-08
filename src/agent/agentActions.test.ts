import { describe, expect, it } from 'vitest';
import {
  agentActions,
  getAgentAvailableResourcesForPhase,
  getAgentAction,
  getAgentActionValidation,
  requiresAgentConfirmation,
} from './agentActions';

describe('agentActions', () => {
  it('keeps experiment navigation actions safe', () => {
    expect(getAgentAction('go_next_page')?.risk).toBe('safe');
    expect(getAgentAction('open_experiment_settings')?.risk).toBe('safe');
    expect(getAgentAction('generate_music')?.risk).toBe('resource_sensitive');
  });

  it('requires confirmation only for stimulus and resource actions', () => {
    expect(requiresAgentConfirmation('go_next_page')).toBe(false);
    expect(requiresAgentConfirmation('play_video')).toBe(true);
    expect(requiresAgentConfirmation('generate_music')).toBe(true);
  });

  it('validates actions by experiment phase', () => {
    expect(getAgentActionValidation('open_experiment_settings', 'baseline')).toEqual({ ok: true });
    expect(getAgentActionValidation('open_paradigm', 'video_regulation')).toEqual({ ok: true });
    expect(getAgentActionValidation('skip_game', 'game_regulation')).toEqual({ ok: true });
  });

  it('keeps the action list small and explicit', () => {
    expect(agentActions.map((action) => action.id)).toEqual([
      'open_paradigm',
      'open_experiment_settings',
      'go_next_page',
      'go_to_phase',
      'select_video',
      'play_video',
      'generate_music',
      'skip_game',
      'finish_experiment',
      'cancel',
    ]);
  });

  it('scopes planner resources to the current phase', () => {
    const videos = [{ id: 'v1', title: 'video', tags: ['calm'] }];

    expect(getAgentAvailableResourcesForPhase('video_regulation', videos)).toEqual({
      gameAvailable: false,
      musicGeneration: false,
      videos,
    });
    expect(getAgentAvailableResourcesForPhase('music_regulation', videos)).toEqual({
      gameAvailable: false,
      musicGeneration: true,
      videos: [],
    });
  });
});
