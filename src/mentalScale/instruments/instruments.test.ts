import { describe, expect, it } from 'vitest';
import {
  PHQ4_ANCHOR_LABELS,
  PHQ4_SCALE_ID,
  PHQ4_TIMEFRAME,
  phq4Items,
  scorePhq4,
} from './phq4';
import {
  PANAS_NA_ITEM_IDS,
  PANAS_PA_ITEM_IDS,
  PANAS_ANCHOR_LABELS,
  panas20Items,
  scorePanas20,
} from './panas20';
import {
  STAI_S_ANCHOR_LABELS,
  STAI_S_REVERSED_ITEM_IDS,
  STAI_S_SCALE_ID,
  STAI_S_TOTAL_MAX,
  STAI_S_TOTAL_MIN,
  scoreStaiS,
  staiSItems,
  staiSItemScore,
} from './staiS';
import {
  STAI_PANAS_BATTERY_SCALE_ID,
  batteryDimensionKeys,
  buildBatteryDefinition,
  buildBatteryRawAnswers,
  computeBatteryDimensions,
  isInstrumentSectionComplete,
  staiPanasBatteryDefinition,
} from './battery';
import {
  SAM_MAX_VALUE,
  SAM_MIN_VALUE,
  samDimensionKeys,
  samDimensions,
  samScaleId,
  scoreSam,
} from './sam';
import {
  GEMS9_ANCHOR_LABELS,
  GEMS9_MAX_VALUE,
  GEMS9_MIN_VALUE,
  GEMS9_SCALE_ID,
  gems9Items,
  gems9MusicV1,
  scoreGems9,
} from './gems9';

/**
 * Scoring contracts for the standardized instruments (doc
 * scale-instruments.md §2.1-§2.3, §3.1). The pure scorers are the load-bearing
 * surface: the improvement engine consumes their output verbatim.
 */

/** Builds {S1: value} / {P1: value} maps from one value per item. */
function uniformAnswers(ids: readonly string[], value: number): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [id, value]));
}

const STAI_IDS = staiSItems.map((item) => item.id);
const PANAS_IDS = panas20Items.map((item) => item.id);

/**
 * Raw answers that make every scored item equal `value`: reversed items need
 * the flipped raw answer (5 − value). Uniform raw answers cannot reach the
 * total range ends because the 10 reverse-keyed items cancel them out.
 */
function scoredStaiAnswers(value: number): Record<string, number> {
  return Object.fromEntries(
    staiSItems.map((item) => [item.id, item.reversed ? 5 - value : value]),
  );
}

describe('STAI-S scoring (doc §2.2)', () => {
  it('ranges 20-80: every-item-scores-1 totals 20, every-item-scores-4 totals 80', () => {
    expect(scoreStaiS(scoredStaiAnswers(1)).total).toBe(STAI_S_TOTAL_MIN);
    expect(scoreStaiS(scoredStaiAnswers(1)).total).toBe(20);
    expect(scoreStaiS(scoredStaiAnswers(4)).total).toBe(STAI_S_TOTAL_MAX);
    expect(scoreStaiS(scoredStaiAnswers(4)).total).toBe(80);
    // A uniform raw answer sits at the exact center: the 10 reverse-keyed
    // items cancel the 10 forward items.
    expect(scoreStaiS(uniformAnswers(STAI_IDS, 1)).total).toBe(50);
    expect(scoreStaiS(uniformAnswers(STAI_IDS, 4)).total).toBe(50);
  });

  it('all-middle answers score exactly 50 (anchor-neutral center)', () => {
    // 10 forward items x 2 + 10 reversed items x (5 - 2) = 20 + 30 = 50.
    expect(scoreStaiS(uniformAnswers(STAI_IDS, 2)).total).toBe(50);
  });

  it('scores the reverse-keyed items 1→4 … 4→1 and forward items verbatim', () => {
    // Doc §2.2 reverse keys, verbatim.
    expect(STAI_S_REVERSED_ITEM_IDS).toEqual([
      'S1', 'S2', 'S5', 'S8', 'S10', 'S11', 'S15', 'S16', 'S19', 'S20',
    ]);

    const calm = staiSItems.find((item) => item.id === 'S1')!;
    const tense = staiSItems.find((item) => item.id === 'S3')!;
    expect(staiSItemScore(calm, 1)).toBe(4);
    expect(staiSItemScore(calm, 4)).toBe(1);
    expect(staiSItemScore(tense, 1)).toBe(1);
    expect(staiSItemScore(tense, 4)).toBe(4);
  });

  it('matches an independent hand computation on a mixed answer set', () => {
    // Deterministic mixed pattern: value = (index % 4) + 1, i.e. 1..4 cycling.
    // The expected values reuse the DOC reverse key (not the module's flags),
    // so a wrong item flag cannot pass both sides.
    const docReverseIds = new Set(['S1', 'S2', 'S5', 'S8', 'S10', 'S11', 'S15', 'S16', 'S19', 'S20']);
    const answers: Record<string, number> = {};
    let expectedTotal = 0;
    staiSItems.forEach((item, index) => {
      const raw = (index % 4) + 1;
      answers[item.id] = raw;
      expectedTotal += docReverseIds.has(item.id) ? 5 - raw : raw;
    });

    expect(scoreStaiS(answers).total).toBe(expectedTotal);
  });

  it('throws on missing or out-of-range answers', () => {
    const incomplete = uniformAnswers(STAI_IDS, 3);
    delete incomplete.S7;
    expect(() => scoreStaiS(incomplete)).toThrow(/S7/);

    expect(() => scoreStaiS({ ...uniformAnswers(STAI_IDS, 3), S7: 0 })).toThrow(/S7/);
    expect(() => scoreStaiS({ ...uniformAnswers(STAI_IDS, 3), S7: 5 })).toThrow(/S7/);
  });
});

describe('state-PANAS scoring (doc §2.3)', () => {
  it('splits 10 PA and 10 NA items per the doc table', () => {
    expect(PANAS_PA_ITEM_IDS).toEqual([
      'P1', 'P3', 'P5', 'P9', 'P10', 'P12', 'P14', 'P16', 'P17', 'P19',
    ]);
    expect(PANAS_NA_ITEM_IDS).toEqual([
      'P2', 'P4', 'P6', 'P7', 'P8', 'P11', 'P13', 'P15', 'P18', 'P20',
    ]);
    expect(PANAS_PA_ITEM_IDS.length + PANAS_NA_ITEM_IDS.length).toBe(20);
  });

  it('computes subscale means: all-lowest 1, all-highest 5', () => {
    expect(scorePanas20(uniformAnswers(PANAS_IDS, 1))).toEqual({ paMean: 1, naMean: 1 });
    expect(scorePanas20(uniformAnswers(PANAS_IDS, 5))).toEqual({ paMean: 5, naMean: 5 });
  });

  it('means over mixed answers match hand computation with 4-decimal precision', () => {
    // Hand-checked fixed answer set: PA sums to 23 (mean 2.3), NA sums to 30
    // (mean 3.0).
    const answers: Record<string, number> = {
      P1: 1, P3: 2, P5: 3, P9: 4, P10: 1, P12: 2, P14: 3, P16: 4, P17: 1, P19: 2,
      P2: 5, P4: 4, P6: 3, P7: 2, P8: 1, P11: 5, P13: 4, P15: 3, P18: 2, P20: 1,
    };

    const score = scorePanas20(answers);
    expect(score.paMean).toBe(2.3);
    expect(score.naMean).toBe(3);
  });

  it('throws on missing or out-of-range answers', () => {
    const incomplete = uniformAnswers(PANAS_IDS, 3);
    delete incomplete.P15;
    expect(() => scorePanas20(incomplete)).toThrow(/P15/);

    expect(() => scorePanas20({ ...uniformAnswers(PANAS_IDS, 3), P15: 6 })).toThrow(/P15/);
  });
});

describe('battery dimensions (doc §3.1/§3.2)', () => {
  it('emits exactly the engine keys anxiety, mood, energy', () => {
    expect([...batteryDimensionKeys]).toEqual(['anxiety', 'mood', 'energy']);
  });

  it('maps anxiety=STAI-S total, mood=NA mean, energy=6−PA mean', () => {
    const dimensions = computeBatteryDimensions(
      uniformAnswers(STAI_IDS, 2), // STAI total 50
      uniformAnswers(PANAS_IDS, 3), // PA 3, NA 3
    );

    expect(dimensions).toEqual({ anxiety: 50, mood: 3, energy: 3 });
  });

  it('keeps the lower=better polarity: energy inverts PA with the 1↔5 boundary', () => {
    // PA all 5 (most energetic) → energy score 1; PA all 1 → energy score 5.
    expect(computeBatteryDimensions(uniformAnswers(STAI_IDS, 1), uniformAnswers(PANAS_IDS, 5)).energy).toBe(1);
    expect(computeBatteryDimensions(uniformAnswers(STAI_IDS, 1), uniformAnswers(PANAS_IDS, 1)).energy).toBe(5);

    // A worse state reads higher on every engine dimension: max anxiety, max
    // NA, min PA (least positive affect → highest inverted energy score);
    // improvement then means a lower post score, matching the backend
    // (baseline − post)/baseline formula.
    const panasAnswers = (paValue: number, naValue: number) => Object.fromEntries(
      panas20Items.map((item) => [item.id, item.subscale === 'PA' ? paValue : naValue]),
    );
    const worse = computeBatteryDimensions(scoredStaiAnswers(4), panasAnswers(1, 5));
    const better = computeBatteryDimensions(scoredStaiAnswers(1), panasAnswers(5, 1));
    expect(worse.anxiety).toBeGreaterThan(better.anxiety);
    expect(worse.mood).toBeGreaterThan(better.mood);
    expect(worse.energy).toBeGreaterThan(better.energy);
  });
});

describe('battery record payload (doc §3.3)', () => {
  it('uses the frozen battery scale_id', () => {
    expect(STAI_PANAS_BATTERY_SCALE_ID).toBe('stai_panas_battery_v1');
    expect(staiPanasBatteryDefinition.scaleId).toBe('stai_panas_battery_v1');
    expect(STAI_S_SCALE_ID).toBe('stai_s_state_v1');
  });

  it('stores raw answers as {stai, panas, timeframe: now} without sharing references', () => {
    const answers = {
      stai: { S1: 1, S2: 4 },
      panas: { P1: 3, P20: 5 },
    };

    const raw = buildBatteryRawAnswers(answers);
    expect(raw).toEqual({
      stai: { S1: 1, S2: 4 },
      panas: { P1: 3, P20: 5 },
      timeframe: 'now',
    });

    // Mutating the stored payload must not touch the live dialog state.
    (raw.stai as Record<string, number>).S1 = 99;
    expect(answers.stai.S1).toBe(1);
  });

  it('renders two sections of 20 items with the doc anchors and instructions', () => {
    const { sections } = staiPanasBatteryDefinition;
    expect(sections).toHaveLength(2);

    const [stai, panas] = sections;
    expect(stai.questions).toHaveLength(20);
    expect(panas.questions).toHaveLength(20);
    expect([...stai.anchorLabels]).toEqual([...STAI_S_ANCHOR_LABELS]);
    expect([...panas.anchorLabels]).toEqual([...PANAS_ANCHOR_LABELS]);
    expect(stai.anchorLabels).toHaveLength(4);
    expect(panas.anchorLabels).toHaveLength(5);
    expect(stai.minValue).toBe(1);
    expect(panas.minValue).toBe(1);
    expect(stai.instruction).toContain('此时此刻');
    expect(panas.instruction).toBe('此刻你的感受有多符合下列词语');

    // Every item carries both renderings and a unique id across the battery.
    const ids = new Set([...stai.questions, ...panas.questions].map((q) => q.id));
    expect(ids.size).toBe(40);
  });

  it('completeness requires every question of every section', () => {
    const staiSection = staiPanasBatteryDefinition.sections[0];
    const panasSection = staiPanasBatteryDefinition.sections[1];

    const staiAnswers = uniformAnswers(STAI_IDS, 2);
    expect(isInstrumentSectionComplete(staiSection, staiAnswers)).toBe(true);
    expect(isInstrumentSectionComplete(panasSection, {})).toBe(false);

    delete staiAnswers.S20;
    expect(isInstrumentSectionComplete(staiSection, staiAnswers)).toBe(false);
  });
});

describe('PHQ-4 scoring (doc §2.1)', () => {
  it('uses the frozen screening scale_id and trait timeframe', () => {
    expect(PHQ4_SCALE_ID).toBe('phq4_screen_v1');
    expect(PHQ4_TIMEFRAME).toBe('past_2_weeks');
  });

  it('registers the four items verbatim in doc order', () => {
    expect(phq4Items.map((item) => item.textZh)).toEqual([
      '做事时提不起劲或没有兴趣',
      '感到心情低落、沮丧或绝望',
      '感觉紧张、焦虑或着急',
      '不能停止或控制担忧',
    ]);
    expect([...PHQ4_ANCHOR_LABELS]).toEqual(['完全不会', '好几天', '一半以上的天数', '几乎每天']);
  });

  it('scores depression=items 1+2 and anxiety=items 3+4', () => {
    expect(scorePhq4({ phq4_1: 0, phq4_2: 1, phq4_3: 2, phq4_4: 3 })).toEqual({
      depression: 1,
      anxiety: 5,
      total: 6,
    });
  });

  it('ranges 0-12: all-zero and all-max totals', () => {
    const allZero = { phq4_1: 0, phq4_2: 0, phq4_3: 0, phq4_4: 0 };
    const allMax = { phq4_1: 3, phq4_2: 3, phq4_3: 3, phq4_4: 3 };
    expect(scorePhq4(allZero)).toEqual({ depression: 0, anxiety: 0, total: 0 });
    expect(scorePhq4(allMax)).toEqual({ depression: 6, anxiety: 6, total: 12 });
  });

  it('throws on missing or out-of-range answers', () => {
    expect(() => scorePhq4({ phq4_1: 1, phq4_2: 1, phq4_3: 1 })).toThrow(/phq4_4/);
    expect(() => scorePhq4({ phq4_1: 4, phq4_2: 1, phq4_3: 1, phq4_4: 1 })).toThrow(/phq4_1/);
  });
});

describe('SAM manipulation check (doc §2.4)', () => {
  it('uses the frozen sam scale id and the three VAD dimensions in order', () => {
    expect(samScaleId).toBe('sam_vad_v1');
    expect([...samDimensionKeys]).toEqual(['valence', 'arousal', 'dominance']);
    expect(samDimensions.map((dimension) => dimension.textZh)).toEqual(['效价', '唤醒', '支配']);
  });

  it('carries the bipolar anchors 1=unpleasant/calm/controlled ↔ 9=pleasant/excited/dominant', () => {
    expect(samDimensions.map((dimension) => dimension.lowLabel)).toEqual([
      '非常不愉快', '完全平静', '完全受控',
    ]);
    expect(samDimensions.map((dimension) => dimension.highLabel)).toEqual([
      '非常愉快', '完全激动', '完全主导',
    ]);
    expect(SAM_MIN_VALUE).toBe(1);
    expect(SAM_MAX_VALUE).toBe(9);
  });

  it('passes boundary and middle 1-9 answers through verbatim (descriptive, no polarity flip)', () => {
    expect(scoreSam({ valence: 1, arousal: 1, dominance: 1 })).toEqual({
      valence: 1, arousal: 1, dominance: 1,
    });
    expect(scoreSam({ valence: 9, arousal: 9, dominance: 9 })).toEqual({
      valence: 9, arousal: 9, dominance: 9,
    });
    expect(scoreSam({ valence: 5, arousal: 3, dominance: 7 })).toEqual({
      valence: 5, arousal: 3, dominance: 7,
    });
  });

  it('throws on missing, out-of-range, or non-integer answers', () => {
    expect(() => scoreSam({ valence: 5, arousal: 5 })).toThrow(/dominance/);
    expect(() => scoreSam({ arousal: 5, dominance: 5 })).toThrow(/valence/);
    expect(() => scoreSam({ valence: 0, arousal: 5, dominance: 5 })).toThrow(/valence/);
    expect(() => scoreSam({ valence: 10, arousal: 5, dominance: 5 })).toThrow(/valence/);
    expect(() => scoreSam({ valence: 1.5, arousal: 5, dominance: 5 })).toThrow(/valence/);
  });
});

describe('GEMS-9 music-specific scale (doc §2.5)', () => {
  it('uses the frozen scale id and the nine doc dimensions in order', () => {
    expect(GEMS9_SCALE_ID).toBe('gems9_music_v1');
    expect(gems9Items.map((item) => item.textZh)).toEqual([
      '惊叹', '超越', '怀旧', '温柔', '宁静', '欢快', '力量', '紧张', '悲伤',
    ]);
    expect(gems9Items.map((item) => item.textEn)).toEqual([
      'Wonder', 'Transcendence', 'Nostalgia', 'Tenderness', 'Peacefulness',
      'Joyful activation', 'Power', 'Tension', 'Sadness',
    ]);
  });

  it('anchors run 完全不同意 → 完全同意 over 1-5 with the doc instruction', () => {
    expect([...GEMS9_ANCHOR_LABELS]).toEqual(['完全不同意', '不同意', '中立', '同意', '完全同意']);
    expect(GEMS9_MIN_VALUE).toBe(1);
    expect(GEMS9_MAX_VALUE).toBe(5);
    expect(gems9MusicV1.instruction).toBe('刚才的音乐让你感受到下列情绪的程度');
    expect(gems9MusicV1.items).toBe(gems9Items);
  });

  it('scores the nine-dimension mean table from single-item answers', () => {
    // One item per dimension: value = (index % 5) + 1, i.e. 1..5 cycling.
    const answers = Object.fromEntries(
      gems9Items.map((item, index) => [item.id, (index % 5) + 1]),
    );

    const score = scoreGems9(answers);
    expect(Object.keys(score)).toHaveLength(9);
    gems9Items.forEach((item, index) => {
      expect(score[item.id]).toBe((index % 5) + 1);
    });
  });

  it('throws on missing or out-of-range answers', () => {
    const uniform = () => Object.fromEntries(gems9Items.map((item) => [item.id, 3]));

    const incomplete = uniform();
    delete incomplete.tension;
    expect(() => scoreGems9(incomplete)).toThrow(/tension/);

    expect(() => scoreGems9({ ...uniform(), joyful_activation: 6 })).toThrow(/joyful_activation/);
    expect(() => scoreGems9({ ...uniform(), sadness: 0 })).toThrow(/sadness/);
  });
});

describe('battery optional sections (doc §3.3 sam/gems sub-objects)', () => {
  it('keeps the default call backward compatible: two sections, no sam/gems keys', () => {
    const definition = buildBatteryDefinition();
    expect(definition.sections.map((section) => section.key)).toEqual(['stai', 'panas']);
    expect(definition.title).toBe('情绪状态量表（STAI-S + PANAS）');
    expect(definition.subtitle).toBe('两个量表均测量「此刻」的状态，请依次完成全部 40 题后提交。');

    // The raw payload stays exactly the doc §3.3 baseline shape.
    const raw = buildBatteryRawAnswers({ stai: { S1: 2 }, panas: { P1: 3 } });
    expect(Object.keys(raw).sort()).toEqual(['panas', 'stai', 'timeframe']);
    expect('sam' in raw).toBe(false);
    expect('gems' in raw).toBe(false);

    // The frozen export still points at the same default definition.
    expect(staiPanasBatteryDefinition.sections.map((section) => section.key)).toEqual(['stai', 'panas']);
  });

  it('prepends the SAM section for the baseline leg and stores raw_answers.sam', () => {
    const definition = buildBatteryDefinition({ includeSam: true });
    expect(definition.sections.map((section) => section.key)).toEqual(['sam', 'stai', 'panas']);

    const [sam, stai, panas] = definition.sections;
    expect(sam.title).toBe('情绪画面感受·操纵检验');
    expect(sam.layout).toBe('bipolar');
    expect(sam.questions.map((question) => question.id)).toEqual(['valence', 'arousal', 'dominance']);
    expect(sam.questions[0].lowLabel).toBe('非常不愉快');
    expect(sam.questions[0].highLabel).toBe('非常愉快');
    // STAI/PANAS stay content-frozen; only their 第X部分 display number shifts.
    expect(stai.questions).toHaveLength(20);
    expect(panas.questions).toHaveLength(20);
    expect(stai.title).toContain('第二部分');
    expect(panas.title).toContain('第三部分');
    expect(stai.anchorLabels).toEqual(staiPanasBatteryDefinition.sections[0].anchorLabels);
    expect(panas.instruction).toBe(staiPanasBatteryDefinition.sections[1].instruction);

    const raw = buildBatteryRawAnswers({
      stai: { S1: 2 },
      panas: { P1: 3 },
      sam: { valence: 5, arousal: 5, dominance: 5 },
    });
    expect(raw.sam).toEqual({ valence: 5, arousal: 5, dominance: 5 });
    expect('gems' in raw).toBe(false);
  });

  it('appends the GEMS section for the music post leg and stores raw_answers.gems', () => {
    const definition = buildBatteryDefinition({ includeGems: true });
    expect(definition.sections.map((section) => section.key)).toEqual(['stai', 'panas', 'gems']);

    const [stai, panas, gems] = definition.sections;
    expect(gems.title).toBe('音乐情绪感受·仅音乐调控');
    expect(gems.questions).toHaveLength(9);
    expect(gems.questions.map((question) => question.id)).toEqual(gems9Items.map((item) => item.id));
    expect([...gems.anchorLabels]).toEqual([...GEMS9_ANCHOR_LABELS]);
    expect(gems.minValue).toBe(1);
    // The default part numbering is untouched when only GEMS is appended.
    expect(stai.title).toContain('第一部分');
    expect(panas.title).toContain('第二部分');

    // The payload build validates the full nine-dimension map, so the stored
    // example carries a complete answer set (partial maps throw, see below).
    const raw = buildBatteryRawAnswers({
      stai: { S1: 2 },
      panas: { P1: 3 },
      gems: Object.fromEntries(gems9Items.map((item) => [item.id, 3])),
    });
    expect(raw.gems).toEqual(Object.fromEntries(gems9Items.map((item) => [item.id, 3])));
    expect('sam' in raw).toBe(false);
  });

  it('combines both optional sections into a four-section definition', () => {
    const definition = buildBatteryDefinition({ includeSam: true, includeGems: true });
    expect(definition.sections.map((section) => section.key)).toEqual(['sam', 'stai', 'panas', 'gems']);
    expect(definition.title).toBe('情绪状态量表（SAM + STAI-S + PANAS + GEMS-9）');

    const questionCount = definition.sections.reduce((sum, section) => sum + section.questions.length, 0);
    expect(questionCount).toBe(52);
  });

  it('validates the optional answers at payload build time as a save-time safety net', () => {
    expect(() => buildBatteryRawAnswers({
      stai: { S1: 1 },
      panas: { P1: 1 },
      sam: { valence: 5 },
    })).toThrow(/arousal/);

    expect(() => buildBatteryRawAnswers({
      stai: { S1: 1 },
      panas: { P1: 1 },
      gems: { wonder: 9 },
    })).toThrow(/wonder/);
  });

  it('completeness still spans optional sections question by question', () => {
    const definition = buildBatteryDefinition({ includeSam: true, includeGems: true });
    const samSection = definition.sections[0];
    const gemsSection = definition.sections[3];

    const samAnswers = { valence: 1, arousal: 9, dominance: 5 };
    expect(isInstrumentSectionComplete(samSection, samAnswers)).toBe(true);
    expect(isInstrumentSectionComplete(gemsSection, { wonder: 3 })).toBe(false);
  });
});
