import { describe, expect, it } from 'vitest';
import {
  createEffectEvaluationFlowState,
  parseFlowState,
  serializeFlowState,
} from './effectEvaluationFlow';
import { prepareEffectHandoff } from './effectPreparationHandoff';

const draft = {
  ...createEffectEvaluationFlowState(),
  subjectId: ' S-01 ',
};

describe('settings to measurement handoff', () => {
  it('opens the pre-induction assessment with the unified protocol before creating a run', () => {
    let value: string | null = null;
    const storage = {
      getItem: () => value,
      setItem: (_: string, next: string) => {
        value = next;
      },
      removeItem: () => {},
    };
    expect(prepareEffectHandoff(draft, storage)).toBe(true);
    expect(parseFlowState(storage.getItem())).toMatchObject({
      subjectId: 'S-01',
      step: 1,
      runId: null,
      preInductionRecordId: null,
      baselineRecordId: null,
    });
  });

  it('preserves an unfinished run and refuses to navigate after a failed write', () => {
    const active = serializeFlowState({ ...draft, step: 2, runId: 'active' });
    let writes = 0;
    const storage = {
      getItem: () => active,
      setItem: () => {
        writes++;
        throw Error('unavailable');
      },
      removeItem: () => {},
    };
    expect(prepareEffectHandoff(draft, storage)).toBe(false);
    expect(writes).toBe(0);
    expect(prepareEffectHandoff(draft, { ...storage, getItem: () => null })).toBe(false);
    expect(writes).toBe(1);
  });
});
