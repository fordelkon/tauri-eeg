import { describe, expect, test } from 'vitest';
import { describeRegulationPoolStatus } from './effectRegulationPool';

const calmEntry = {
  absolutePath: 'C:\\video_paradigm\\Calm\\scenery\\calm-01.mp4',
  fileName: 'scenery/calm-01.mp4',
  videoId: 'scenery/calm-01',
};

describe('describeRegulationPoolStatus', () => {
  test('blocks a missing or empty calm pool before the window starts', () => {
    expect(describeRegulationPoolStatus(null).kind).toBe('blocked');
    expect(describeRegulationPoolStatus([]).kind).toBe('blocked');
  });

  test('keeps the loaded calm entries for the fullscreen stage', () => {
    expect(describeRegulationPoolStatus([calmEntry])).toEqual({
      kind: 'ready',
      entries: [calmEntry],
    });
  });
});
