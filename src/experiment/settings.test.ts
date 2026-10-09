import { describe, expect, it } from 'vitest';
import { parseExperimentPreferences } from './settings';

describe('experiment preparation', () => {
  it('defaults to rehearsal without claiming BDF recording', () => {
    expect(parseExperimentPreferences(null)).toEqual({
      mode: 'rehearsal',
      externalRecordingConfirmed: false,
      expectedRecordingName: '',
    });
  });
  it('requires an explicit boolean recording confirmation', () => {
    expect(
      parseExperimentPreferences(
        '{"mode":"formal","expectedRecordingName":"sub01.bdf","externalRecordingConfirmed":"true"}',
      ),
    ).toEqual({
      mode: 'formal',
      externalRecordingConfirmed: false,
      expectedRecordingName: 'sub01.bdf',
    });
  });
  it('retains the operator preparation and tolerates malformed storage', () => {
    expect(
      parseExperimentPreferences(
        '{"mode":"formal","expectedRecordingName":"sub02.bdf","externalRecordingConfirmed":true}',
      ),
    ).toEqual({
      mode: 'formal',
      externalRecordingConfirmed: true,
      expectedRecordingName: 'sub02.bdf',
    });
    expect(parseExperimentPreferences('{')).toEqual({
      mode: 'rehearsal',
      externalRecordingConfirmed: false,
      expectedRecordingName: '',
    });
  });
});
