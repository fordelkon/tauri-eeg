import { describe, expect, it } from 'vitest';
import { getPreparationReadiness, type PreparationInput } from './preparation';

const prepared: PreparationInput = {
  mode: 'formal',
  desktop: true,
  connected: true,
  libraryValidated: true,
  externalRecordingConfirmed: true,
  activeRunId: null,
};

describe('experiment preparation readiness', () => {
  it('allows a formal experiment after hardware, materials and recording are ready', () => {
    expect(getPreparationReadiness(prepared)).toEqual({ canEnter: true, blockers: [] });
  });

  it('allows rehearsal without a trigger box or ActiView recording', () => {
    expect(
      getPreparationReadiness({
        ...prepared,
        mode: 'rehearsal',
        connected: false,
        externalRecordingConfirmed: false,
      }),
    ).toEqual({ canEnter: true, blockers: [] });
  });

  it('prevents formal entry when BDF saving has not been confirmed', () => {
    expect(getPreparationReadiness({ ...prepared, externalRecordingConfirmed: false })).toEqual({
      canEnter: false,
      blockers: ['请先在 ActiView 开始保存 BDF，并确认保存秒数正在增加。'],
    });
  });

  it('prevents a second experiment while a run is active', () => {
    expect(
      getPreparationReadiness({ ...prepared, mode: 'rehearsal', activeRunId: 'run-1' }),
    ).toEqual({
      canEnter: false,
      blockers: ['当前实验尚未结束，请先完成或中止当前实验。'],
    });
  });

  it('requires validated materials even for rehearsal', () => {
    expect(
      getPreparationReadiness({ ...prepared, mode: 'rehearsal', libraryValidated: false }),
    ).toEqual({
      canEnter: false,
      blockers: ['请先选择素材库并完成验证。'],
    });
  });

  it('prevents browser entry even when the settings otherwise look ready', () => {
    expect(getPreparationReadiness({ ...prepared, desktop: false })).toEqual({
      canEnter: false,
      blockers: ['请在桌面应用中准备并开始实验。'],
    });
  });

  it('shows all missing formal preparation actions together', () => {
    expect(
      getPreparationReadiness({
        ...prepared,
        connected: false,
        libraryValidated: false,
        externalRecordingConfirmed: false,
      }),
    ).toEqual({
      canEnter: false,
      blockers: [
        '请先选择素材库并完成验证。',
        '请先连接触发盒。',
        '请先在 ActiView 开始保存 BDF，并确认保存秒数正在增加。',
      ],
    });
  });
});
