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

  test('starts the prompt builder without fixed therapeutic default tags', () => {
    const source = readText(new URL('./MusicRegulation.tsx', import.meta.url));

    expect(source).toContain('const [instruments, setInstruments] = useState<string[]>([])');
    expect(source).toContain('const [selectedStyles, setSelectedStyles] = useState<string[]>([])');
    expect(source).toContain('const [detailTemplates, setDetailTemplates] = useState<string[]>([])');
    expect(source).toContain("const [details, setDetails] = useState('')");
    expect(source).not.toContain("useState<string[]>(['piano'])");
    expect(source).not.toContain("useState<string[]>(['ambient instrumental'])");
    expect(source).not.toContain("useState<string[]>(['calm therapeutic texture'])");
    expect(source).not.toContain("useState('soft strings')");
  });

  test('applies assistant music recommendations to prompt builder selections', () => {
    const source = readText(new URL('./MusicRegulation.tsx', import.meta.url));

    expect(source).toContain("window.addEventListener('agent:music-prompt'");
    expect(source).toContain("window.removeEventListener('agent:music-prompt'");
    expect(source).toContain('applyAgentMusicPrompt');
    expect(source).toContain('setSelectedStyles(selectTagValues(styleOptions, [detail.style], setCustomStyle))');
    expect(source).toContain('setDetailTemplates(templateMatches)');
    expect(source).toContain('setDetails(customDetails.join');
    expect(source).toContain('setGenerationDuration(detail.duration)');
  });
});
