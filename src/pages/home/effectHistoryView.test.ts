import { describe, expect, it } from 'vitest';
import type { EffectHistoryEntryView } from '../../mentalScale/scaleRecordsApi';
import {
  filterHistoryEntries,
  formatMeanImprovementRate,
  formatRunTimestamp,
  groupHistoryBySubject,
  labelForEmotion,
  outcomeForEntry,
} from './effectHistoryView';

/**
 * The history review tab's grouping, filtering, and display rules are pure
 * functions — pinned here without React or Tauri.
 */

function entry(overrides: Partial<EffectHistoryEntryView> = {}): EffectHistoryEntryView {
  return {
    subjectId: 's1',
    baselineRecordId: 'rec-baseline',
    postRecordId: 'rec-post',
    baselineCreatedAt: '2026-08-01T09:00:00+00:00',
    postCreatedAt: '2026-08-01T10:00:00+00:00',
    scaleId: '/video-regulation',
    emotion: 'anxiety',
    durationMinutes: 5,
    regulationSkipped: false,
    meanImprovementRate: 0.4,
    meetsThreshold: true,
    dimensions: [],
    ...overrides,
  };
}

describe('groupHistoryBySubject (历史列表分组)', () => {
  it('groups runs per subject, newest run first inside each group', () => {
    const groups = groupHistoryBySubject([
      entry({ subjectId: 's1', postRecordId: 'p-old', postCreatedAt: '2026-08-01T10:00:00+00:00' }),
      entry({ subjectId: 's2', postRecordId: 'p-s2', postCreatedAt: '2026-08-02T10:00:00+00:00' }),
      entry({ subjectId: 's1', postRecordId: 'p-new', postCreatedAt: '2026-08-03T10:00:00+00:00' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].subjectId).toBe('s1');
    expect(groups[0].entries.map((run) => run.postRecordId)).toEqual(['p-new', 'p-old']);
    expect(groups[1].subjectId).toBe('s2');
  });

  it('orders subjects by their newest run and sends the unbound group last', () => {
    const groups = groupHistoryBySubject([
      // Unbound runs collect under the empty subject key.
      entry({ subjectId: '', postRecordId: 'p-unbound', postCreatedAt: '2026-08-05T10:00:00+00:00' }),
      entry({ subjectId: 'late-bloomer', postRecordId: 'p-late', postCreatedAt: '2026-08-04T10:00:00+00:00' }),
      entry({ subjectId: 'early-bird', postRecordId: 'p-early', postCreatedAt: '2026-08-01T10:00:00+00:00' }),
    ]);

    expect(groups.map((group) => group.subjectId)).toEqual([
      'late-bloomer',
      'early-bird',
      '',
    ]);
    expect(groups[2].entries[0].postRecordId).toBe('p-unbound');
  });

  it('keeps whitespace-only subject ids in the unbound group', () => {
    const groups = groupHistoryBySubject([entry({ subjectId: '   ' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].subjectId).toBe('');
  });

  it('returns an empty list for an empty history', () => {
    expect(groupHistoryBySubject([])).toEqual([]);
  });
});

describe('filterHistoryEntries (历史列表过滤)', () => {
  const records = [
    entry({ subjectId: 'subj-001', postRecordId: 'p1' }),
    entry({ subjectId: 'Subj-002', postRecordId: 'p2' }),
    entry({ subjectId: '', postRecordId: 'p3' }),
  ];

  it('keeps every run when the query is blank', () => {
    expect(filterHistoryEntries(records, '')).toHaveLength(3);
    expect(filterHistoryEntries(records, '   ')).toHaveLength(3);
    // A fresh array is returned rather than the caller's reference.
    expect(filterHistoryEntries(records, '')).not.toBe(records);
  });

  it('matches subject ids case-insensitively as a substring', () => {
    expect(filterHistoryEntries(records, 'subj').map((run) => run.postRecordId))
      .toEqual(['p1', 'p2']);
    expect(filterHistoryEntries(records, ' 002 ').map((run) => run.postRecordId))
      .toEqual(['p2']);
  });

  it('returns nothing when no subject matches', () => {
    expect(filterHistoryEntries(records, 'nobody')).toEqual([]);
  });
});

describe('history display helpers', () => {
  it('labels configured emotions in Chinese and degrades gracefully', () => {
    expect(labelForEmotion('anxiety')).toBe('焦虑');
    expect(labelForEmotion('depression')).toBe('抑郁');
    expect(labelForEmotion('fear')).toBe('恐惧');
    expect(labelForEmotion('custom')).toBe('custom');
    expect(labelForEmotion(null)).toBe('—');
  });

  it('formats rates through the shared improvement formatter', () => {
    expect(formatMeanImprovementRate(0.4)).toBe('+40%');
    expect(formatMeanImprovementRate(-0.125)).toBe('-12.5%');
    expect(formatMeanImprovementRate(null)).toBe('—');
  });

  it('derives the outcome verdict from the mean rate and threshold flag', () => {
    expect(outcomeForEntry({ meanImprovementRate: 0.4, meetsThreshold: true })).toBe('达标');
    expect(outcomeForEntry({ meanImprovementRate: -0.02, meetsThreshold: false })).toBe('未达标');
    expect(outcomeForEntry({ meanImprovementRate: null, meetsThreshold: false })).toBe('无法判定');
  });

  it('formats timestamps as local YYYY-MM-DD HH:mm and echoes unparsable input', () => {
    expect(formatRunTimestamp('not-a-timestamp')).toBe('not-a-timestamp');

    const formatted = formatRunTimestamp('2026-08-26T10:00:00+00:00');
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    // Later instants never format before earlier ones (same-zone rendering).
    const later = formatRunTimestamp('2027-01-15T10:00:00+00:00');
    expect(later > formatted).toBe(true);
  });
});
