// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (url: URL) => readFileSync(url, 'utf8');

describe('MusicRegulation generated item refresh contract', () => {
  test('listens for generated music events and inserts the new item immediately', () => {
    const source = readText(new URL('./MusicRegulation.tsx', import.meta.url));

    expect(source).toContain('MUSIC_GENERATED_EVENT');
    expect(source).toContain('addEventListener(MUSIC_GENERATED_EVENT');
    expect(source).toContain('removeEventListener(MUSIC_GENERATED_EVENT');
    expect(source).toContain('CustomEvent<GeneratedMusicHistoryItem>');
    expect(source).toContain(').detail');
    expect(source).toContain('[item, ...items.filter((existing) => existing.id !== item.id)]');
    expect(source).toContain('setActiveIndex(0);');
  });
});
