import { describe, expect, it } from 'vitest';
import { createHomeIntroPlayback } from './homeIntroPlayback';

describe('createHomeIntroPlayback', () => {
  it('plays once per signed-in user session', () => {
    const playback = createHomeIntroPlayback();

    expect(playback.shouldPlay('alice')).toBe(true);
    expect(playback.shouldPlay('alice')).toBe(false);
    expect(playback.shouldPlay('bob')).toBe(true);
    expect(playback.shouldPlay('bob')).toBe(false);
  });

  it('does not play without a signed-in user id', () => {
    const playback = createHomeIntroPlayback();

    expect(playback.shouldPlay(undefined)).toBe(false);
    expect(playback.shouldPlay(null)).toBe(false);
    expect(playback.shouldPlay('')).toBe(false);
  });
});
