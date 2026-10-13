import { describe, expect, it } from 'vitest';
import { buildStandardBdfFileName } from './bdfNaming';

describe('buildStandardBdfFileName', () => {
  it('generates standard BDF name with default options', () => {
    expect(buildStandardBdfFileName()).toBe('sub-001_ses-01_task-effect.bdf');
  });

  it('normalizes subject ID prefixed with sub-, subj-, or raw number', () => {
    expect(buildStandardBdfFileName({ subjectId: '042', task: 'effect' })).toBe(
      'sub-042_ses-01_task-effect.bdf',
    );
    expect(buildStandardBdfFileName({ subjectId: 'sub-007', task: 'effect' })).toBe(
      'sub-007_ses-01_task-effect.bdf',
    );
    expect(buildStandardBdfFileName({ subjectId: 'subj-003', task: 'effect' })).toBe(
      'sub-j-003_ses-01_task-effect.bdf',
    );
  });

  it('maps paradigm destination to task-paradigm', () => {
    expect(buildStandardBdfFileName({ subjectId: '002', task: 'paradigm' })).toBe(
      'sub-002_ses-01_task-paradigm.bdf',
    );
  });

  it('handles custom sessions', () => {
    expect(buildStandardBdfFileName({ subjectId: '001', session: 2 })).toBe(
      'sub-001_ses-02_task-effect.bdf',
    );
  });
});
