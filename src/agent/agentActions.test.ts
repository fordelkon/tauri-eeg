import { describe, expect, it } from 'vitest';
import {
  agentActions,
  getAgentAvailableResourcesForPhase,
  getAgentAction,
  getAgentActionValidation,
  requiresAgentConfirmation,
} from './agentActions';

describe('agentActions', () => {
  it('marks navigation as safe and EEG operations as data sensitive', () => {
    expect(getAgentAction('go_next_page')?.risk).toBe('safe');
    expect(getAgentAction('start_eeg_device_and_record')?.risk).toBe('data_sensitive');
    expect(getAgentAction('stop_and_save_eeg_recording')?.risk).toBe('data_sensitive');
    expect(getAgentAction('generate_music')?.risk).toBe('resource_sensitive');
  });

  it('requires confirmation for EEG, stimulus, and resource actions', () => {
    expect(requiresAgentConfirmation('go_next_page')).toBe(false);
    expect(requiresAgentConfirmation('play_video')).toBe(true);
    expect(requiresAgentConfirmation('start_eeg_device_and_record')).toBe(true);
    expect(requiresAgentConfirmation('generate_music')).toBe(true);
  });

  it('validates actions by experiment phase', () => {
    expect(getAgentActionValidation('start_eeg_recording', 'baseline')).toEqual({ ok: true });
    expect(getAgentActionValidation('start_eeg_recording', 'video_regulation')).toEqual({
      ok: false,
      reason: '当前阶段不能执行该操作。',
    });
    expect(getAgentActionValidation('skip_game', 'game_regulation')).toEqual({ ok: true });
  });

  it('keeps the action list small and explicit', () => {
    expect(agentActions.map((action) => action.id)).toEqual([
      'go_next_page',
      'go_to_phase',
      'start_eeg_device',
      'stop_eeg_device',
      'start_eeg_recording',
      'pause_eeg_recording',
      'resume_eeg_recording',
      'stop_and_save_eeg_recording',
      'start_eeg_device_and_record',
      'stop_save_eeg_and_go_next',
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
