// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const source = readFileSync(new URL('./VideoRegulation.tsx', import.meta.url), 'utf8');

describe('VideoRegulation tag grouping copy', () => {
  test('renders the dense tag step as layered collapsible groups', () => {
    expect(source).toContain('tagOptionGroups');
    expect(source).toContain('getGroupedTagOptions');
    expect(source).toContain('TagGroupSections');
    expect(source).toContain('<details');
    expect(source).toContain('山林植被');
    expect(source).toContain('水域海岸');
    expect(source).toContain('天气天空');
    expect(source).toContain('色调光影');
    expect(source).toContain('情绪氛围');
    expect(source).toContain('其他标签');
  });

  test('keeps only one tag accordion group open at a time', () => {
    expect(source).toContain('openTagGroupLabel');
    expect(source).toContain('handleAccordionSummaryClick');
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('open={openTagGroupLabel === group.label}');
  });
});
