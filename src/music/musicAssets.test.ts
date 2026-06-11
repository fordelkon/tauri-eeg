import { describe, expect, it } from 'vitest';
import { createBundledMusicAssets, createGeneratedMusicAsset } from './musicAssets';

describe('createBundledMusicAssets', () => {
  it('creates wav-only bundled asset urls in source order', () => {
    const assets = createBundledMusicAssets(['calm.wav', 'notes.txt', 'legacy.mp3', 'focus.wav']);

    expect(assets).toEqual([
      {
        id: 'bundled-wav-1',
        fileName: 'calm.wav',
        title: 'calm',
        mediaUrl: '/music/calm.wav',
        mimeType: 'audio/wav',
        source: 'bundled',
        cover: {
          accent: expect.stringMatching(/^#[0-9a-f]{6}$/),
          angle: expect.any(Number),
          primary: expect.stringMatching(/^#[0-9a-f]{6}$/),
          secondary: expect.stringMatching(/^#[0-9a-f]{6}$/),
        },
      },
      {
        id: 'bundled-wav-2',
        fileName: 'focus.wav',
        title: 'focus',
        mediaUrl: '/music/focus.wav',
        mimeType: 'audio/wav',
        source: 'bundled',
        cover: {
          accent: expect.stringMatching(/^#[0-9a-f]{6}$/),
          angle: expect.any(Number),
          primary: expect.stringMatching(/^#[0-9a-f]{6}$/),
          secondary: expect.stringMatching(/^#[0-9a-f]{6}$/),
        },
      },
    ]);
  });

  it('generates stable cover palettes from the file name', () => {
    const first = createBundledMusicAssets(['calm.wav'])[0];
    const second = createBundledMusicAssets(['calm.wav'])[0];
    const different = createBundledMusicAssets(['focus.wav'])[0];

    expect(first.cover).toEqual(second.cover);
    expect(first.cover).not.toEqual(different.cover);
    expect(first.cover.angle).toBeGreaterThanOrEqual(0);
    expect(first.cover.angle).toBeLessThan(360);
  });

  it('creates generated wav assets with playable tauri file urls', () => {
    const asset = createGeneratedMusicAsset({
      id: 'job-1',
      prompt: 'calm piano',
      filePath: 'C:\\Users\\name\\AppData\\Local\\tauri-eeg\\music\\gen_job.wav',
      createdAt: '2026-06-11T08:00:00Z',
      durationSeconds: 30,
      modelVersion: 'stable-audio-3-small-music',
    }, (filePath) => `asset://${filePath}`);

    expect(asset).toMatchObject({
      id: 'job-1',
      fileName: 'gen_job.wav',
      title: 'calm piano',
      mediaUrl: 'asset://C:\\Users\\name\\AppData\\Local\\tauri-eeg\\music\\gen_job.wav',
      mimeType: 'audio/wav',
      source: 'generated',
    });
  });
});
