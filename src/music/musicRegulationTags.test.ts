import { describe, expect, it } from 'vitest';
import { getCompactTagSummary, getNextOpenTagSelector } from './musicRegulationTags';

describe('getCompactTagSummary', () => {
  it('reports selected labels and counts for compact tag controls', () => {
    const summary = getCompactTagSummary(
      [
        { label: 'Piano', value: 'piano' },
        { label: 'Violin', value: 'violin' },
        { label: 'Guitar', value: 'guitar' },
      ],
      ['piano', 'guitar'],
    );

    expect(summary).toEqual({
      countLabel: '2/3',
      label: 'Piano, Guitar',
    });
  });

  it('uses a fallback label when no option is selected', () => {
    const summary = getCompactTagSummary(
      [
        { label: 'Ambient', value: 'ambient instrumental' },
        { label: 'Pop', value: 'pop instrumental' },
      ],
      [],
    );

    expect(summary).toEqual({
      countLabel: '0/2',
      label: 'Choose tags',
    });
  });

  it('shows custom text for selected custom options when provided', () => {
    const summary = getCompactTagSummary(
      [
        { label: 'Piano', value: 'piano' },
        { label: 'Other', value: 'custom' },
      ],
      ['custom'],
      { custom: 'Erhu' },
    );

    expect(summary).toEqual({
      countLabel: '1/2',
      label: 'Erhu',
    });
  });
});

describe('getNextOpenTagSelector', () => {
  it('opens the requested selector and closes the current one', () => {
    expect(getNextOpenTagSelector('instrument', 'style')).toBe('style');
  });

  it('closes a selector when the same selector is requested again', () => {
    expect(getNextOpenTagSelector('style', 'style')).toBeNull();
  });
});
