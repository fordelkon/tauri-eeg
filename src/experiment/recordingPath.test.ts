import { describe, expect, it } from 'vitest';
import {
  recordingPlanKey,
  requirePreparedRecording,
  triggerCheckPath,
  type RecordingPlan,
} from './recordingPath';

const plan: RecordingPlan = {
  userId: 'account',
  subjectId: 'sub-001',
  kind: 'effect_evaluation',
  condition: 'natural_recovery',
};
const file = 'D:/EEG/sub-001_ses-01_task-effectbaseline_run-02_eeg.bdf';
const preferences = {
  mode: 'formal' as const,
  expectedRecordingName: file,
  recordingPlanKey: recordingPlanKey(plan),
  externalRecordingConfirmed: true,
};

describe('ActiView preparation', () => {
  it('keeps the short test distinct from the reserved formal output', () => {
    expect(triggerCheckPath(file)).toBe(
      'D:/EEG/sub-001_ses-01_task-effectbaseline_acq-triggercheck_run-02_eeg.bdf',
    );
  });
  it('accepts an unchanged baseline plan, ignoring its unused method', () => {
    expect(() => requirePreparedRecording(preferences, { ...plan, method: 'music' })).not.toThrow();
  });
  it('requires a fresh confirmation for another account, subject, task, or session', () => {
    for (const other of [
      { ...plan, userId: 'another' },
      { ...plan, subjectId: 'sub-002' },
      { ...plan, session: 2 },
      { ...plan, kind: 'personal_calibration' as const },
      { ...plan, condition: 'regulation' as const, method: 'video' as const },
    ])
      expect(() => requirePreparedRecording(preferences, other)).toThrow();
    expect(() =>
      requirePreparedRecording({ ...preferences, externalRecordingConfirmed: false }, plan),
    ).toThrow();
  });
});
