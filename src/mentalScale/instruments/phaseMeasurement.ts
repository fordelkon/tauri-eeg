import {
  STAI_PANAS_BATTERY_SCALE_ID,
  batteryDimensionKeys,
  buildBatteryRawAnswers,
  computeBatteryDimensions,
  type BatteryAnswers,
} from './battery';
import { BRIEF_SCALE_ID, samDimensionKeys, scoreSam, type SamScore } from './sam';

/** Keep each protocol's raw scale and direction intact at the persistence boundary. */
export function buildPhaseMeasurement(
  protocol: 'brief' | 'full',
  answers: BatteryAnswers | SamScore,
) {
  if (protocol === 'brief' && 'valence' in answers) {
    const ratings = scoreSam(answers);
    return {
      scaleId: BRIEF_SCALE_ID,
      dimensionScores: ratings,
      rawAnswers: { ...ratings, timeframe: 'now' },
      measuredDimensions: [...samDimensionKeys],
    };
  }
  if (protocol === 'full' && 'stai' in answers) {
    return {
      scaleId: STAI_PANAS_BATTERY_SCALE_ID,
      dimensionScores: computeBatteryDimensions(answers.stai, answers.panas),
      rawAnswers: buildBatteryRawAnswers(answers),
      measuredDimensions: [...batteryDimensionKeys],
    };
  }
  throw new Error('本次回答与已选评价方案不一致。');
}
