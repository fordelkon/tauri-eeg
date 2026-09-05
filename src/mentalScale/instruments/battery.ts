/**
 * STAI-S + state-PANAS combined battery — the wizard's node ②/④ pre/post
 * instrument (docs/scale-instruments.md §1, §2.2, §2.3, §3). The SAME battery
 * is used for every run regardless of the regulation method: the measurement
 * tool must not vary across intervention arms (doc §0.3).
 *
 * Optional sections (doc §2.4/§2.5/§3.3): the SAM manipulation check can be
 * prepended (baseline leg) and the GEMS-9 music section appended (post leg,
 * music condition only). Neither auxiliary scale gets its own scale_records
 * row — their answers ride the same battery record as raw_answers.sam /
 * raw_answers.gems, avoiding the backend validate_phase (baseline|post only)
 * and build_effect_history (subject,condition) pairing limits.
 *
 * Engine interface (doc §3.1/§3.2): every emitted dimension score is already
 * polarity-normalized to lower=better HERE, in the frontend scoring function,
 * so the backend `(baseline − post)/baseline` formula stays untouched.
 */

import { scorePanas20, panas20Items, PANAS_ANCHOR_LABELS, PANAS_MIN_VALUE, PANAS_STATE_INSTRUCTION, round4 } from './panas20';
import { scoreStaiS, staiSItems, STAI_S_ANCHOR_LABELS, STAI_S_MIN_VALUE, STAI_S_STATE_INSTRUCTION } from './staiS';
import {
  SAM_INSTRUCTION,
  SAM_MAX_VALUE,
  SAM_MIN_VALUE,
  samDimensions,
  scoreSam,
} from './sam';
import {
  GEMS9_ANCHOR_LABELS,
  GEMS9_INSTRUCTION,
  GEMS9_MIN_VALUE,
  gems9Items,
  scoreGems9,
} from './gems9';

export const STAI_PANAS_BATTERY_SCALE_ID = 'stai_panas_battery_v1';

/** Engine dimensions emitted by the battery, in canonical order (doc §3.1). */
export const batteryDimensionKeys = ['anxiety', 'mood', 'energy'] as const;

export type BatteryDimensionKey = (typeof batteryDimensionKeys)[number];

export type BatteryDimensionScores = Record<BatteryDimensionKey, number>;

/** Flat per-section answer map: {S1: 1..4} / {P1: 1..5} / {valence: 1..9} / … */
export type InstrumentAnswers = Record<string, number>;

export type BatteryAnswers = {
  stai: InstrumentAnswers;
  panas: InstrumentAnswers;
  /** SAM manipulation-check answers; present only when the SAM section ran. */
  sam?: InstrumentAnswers;
  /** GEMS-9 answers; present only when the GEMS section ran (music post). */
  gems?: InstrumentAnswers;
};

export type InstrumentQuestion = {
  id: string;
  /** Original English item (kept for audit; the UI shows the Chinese text). */
  textEn: string;
  /** Chinese rendering shown in the UI (doc tables, verbatim). */
  textZh: string;
  /** Bipolar end labels (SAM sections only): labels for minValue/maxValue. */
  lowLabel?: string;
  highLabel?: string;
};

export type BatterySectionKey = 'sam' | 'stai' | 'panas' | 'gems';

export type InstrumentSection = {
  key: BatterySectionKey;
  title: string;
  instruction: string;
  /** Anchor labels ordered from `minValue` upward (unused by bipolar sections). */
  anchorLabels: readonly string[];
  minValue: number;
  /** Highest numeric value; only bipolar sections need it (anchor sections
   *  derive their maximum from anchorLabels.length). */
  maxValue?: number;
  questions: readonly InstrumentQuestion[];
  /** 'bipolar' renders end labels around bare numeric buttons (SAM); the
   *  default renders one labelled button per anchor value. */
  layout?: 'bipolar';
};

export type BatteryDefinition = {
  scaleId: typeof STAI_PANAS_BATTERY_SCALE_ID;
  title: string;
  subtitle: string;
  sections: readonly InstrumentSection[];
};

/**
 * Section titles for the optional parts (task spec, verbatim): the SAM
 * preamble check and the music-only GEMS closing section carry no 第X部分
 * numbering — the state scales keep their own.
 */
const SAM_SECTION_TITLE = '情绪画面感受·操纵检验';
const GEMS_SECTION_TITLE = '音乐情绪感受·仅音乐调控';

/** The three SAM questions rendered as bipolar rows (numeric 1-9 variant). */
const SAM_QUESTIONS: readonly InstrumentQuestion[] = samDimensions.map((dimension) => ({
  id: dimension.id,
  textEn: dimension.textEn,
  textZh: dimension.textZh,
  lowLabel: dimension.lowLabel,
  highLabel: dimension.highLabel,
}));

/** The nine GEMS-9 questions rendered with the shared 1-5 anchor row. */
const GEMS_QUESTIONS: readonly InstrumentQuestion[] = gems9Items.map((item) => ({
  id: item.id,
  textEn: item.textEn,
  textZh: item.textZh,
}));

/** Chinese part numerals for the dynamic 第X部分 labels of the state scales. */
const PART_NUMERALS = ['一', '二', '三'] as const;

export type BuildBatteryOptions = {
  /** Prepend the SAM manipulation-check section (baseline leg, doc §3.3). */
  includeSam?: boolean;
  /** Append the GEMS-9 music section (post leg, music condition only). */
  includeGems?: boolean;
};

/**
 * Builds the battery definition for one dialog. The STAI-S/PANAS sections are
 * content-frozen; only their 第X部分 display number shifts when an optional
 * section shares the dialog. The default call (no options) reproduces the
 * original two-section definition verbatim.
 */
export function buildBatteryDefinition(options: BuildBatteryOptions = {}): BatteryDefinition {
  const includeSam = options.includeSam === true;
  const includeGems = options.includeGems === true;

  const staiSection: InstrumentSection = {
    key: 'stai',
    title: `第${PART_NUMERALS[includeSam ? 1 : 0]}部分 · 状态焦虑（STAI-S，20 题）`,
    instruction: STAI_S_STATE_INSTRUCTION,
    anchorLabels: STAI_S_ANCHOR_LABELS,
    minValue: STAI_S_MIN_VALUE,
    questions: staiSItems,
  };
  const panasSection: InstrumentSection = {
    key: 'panas',
    title: `第${PART_NUMERALS[includeSam ? 2 : 1]}部分 · 正负性情绪（PANAS，20 题）`,
    instruction: PANAS_STATE_INSTRUCTION,
    anchorLabels: PANAS_ANCHOR_LABELS,
    minValue: PANAS_MIN_VALUE,
    questions: panas20Items,
  };

  const sections: InstrumentSection[] = [];
  if (includeSam) {
    sections.push({
      key: 'sam',
      title: SAM_SECTION_TITLE,
      instruction: SAM_INSTRUCTION,
      anchorLabels: [],
      minValue: SAM_MIN_VALUE,
      maxValue: SAM_MAX_VALUE,
      layout: 'bipolar',
      questions: SAM_QUESTIONS,
    });
  }
  sections.push(staiSection, panasSection);
  if (includeGems) {
    sections.push({
      key: 'gems',
      title: GEMS_SECTION_TITLE,
      instruction: GEMS9_INSTRUCTION,
      anchorLabels: GEMS9_ANCHOR_LABELS,
      minValue: GEMS9_MIN_VALUE,
      questions: GEMS_QUESTIONS,
    });
  }

  const scaleNames = [
    includeSam ? 'SAM' : null,
    'STAI-S',
    'PANAS',
    includeGems ? 'GEMS-9' : null,
  ].filter((name): name is string => name !== null).join(' + ');

  const questionCount = sections.reduce((sum, section) => sum + section.questions.length, 0);
  const gemsTail = includeGems ? '，最后完成 GEMS-9 音乐情绪感受（9 题）' : '';
  const samHead = includeSam ? '先完成 SAM 情绪画面自评（操纵检验 3 题），' : '';

  return {
    scaleId: STAI_PANAS_BATTERY_SCALE_ID,
    title: `情绪状态量表（${scaleNames}）`,
    subtitle: `${samHead}两个量表均测量「此刻」的状态${gemsTail}，请依次完成全部 ${questionCount} 题后提交。`,
    sections,
  };
}

/** The default two-section battery (backward-compatible frozen export). */
export const staiPanasBatteryDefinition: BatteryDefinition = buildBatteryDefinition();

/**
 * Pure battery scoring (doc §3.1): anxiety = STAI-S total (20-80, natively
 * lower=better); mood = PANAS NA mean (1-5, natively lower=better); energy =
 * PANAS PA mean REVERSED as 6 − PA (1-5) so a livelier state scores lower.
 * All values are rounded to 4 decimals; nothing re-scales them downstream.
 * The optional SAM/GEMS sections never enter the engine (doc §1: descriptive).
 */
export function computeBatteryDimensions(
  staiAnswers: InstrumentAnswers,
  panasAnswers: InstrumentAnswers,
): BatteryDimensionScores {
  const { total } = scoreStaiS(staiAnswers);
  const { paMean, naMean } = scorePanas20(panasAnswers);

  return {
    anxiety: total,
    mood: naMean,
    energy: round4(6 - paMean),
  };
}

/**
 * Raw-answers payload stored on the scale_records row (doc §3.3):
 * { stai: {S1..S20}, panas: {P1..P20}, timeframe: 'now', sam?, gems? }. The
 * sam/gems sub-objects appear only when the corresponding answers were
 * collected; the sam payload is validated (1-9 per dimension) and the gems
 * payload (1-5 per dimension) at build time as a save-time safety net.
 */
export function buildBatteryRawAnswers(answers: BatteryAnswers): Record<string, unknown> {
  if (answers.sam) {
    scoreSam(answers.sam);
  }
  if (answers.gems) {
    scoreGems9(answers.gems);
  }

  const raw: Record<string, unknown> = {
    stai: { ...answers.stai },
    panas: { ...answers.panas },
    timeframe: 'now',
  };

  // Doc §3.3: the auxiliary scales ride the SAME record as sub-objects; the
  // keys are absent when their sections were not enabled.
  if (answers.sam) {
    raw.sam = { ...answers.sam };
  }
  if (answers.gems) {
    raw.gems = { ...answers.gems };
  }

  return raw;
}

/** True when every question of the section carries a numeric answer. */
export function isInstrumentSectionComplete(
  section: InstrumentSection,
  answers: InstrumentAnswers,
): boolean {
  return section.questions.every((question) => typeof answers[question.id] === 'number');
}

/** Answered-question count of a section (the per-section progress readout). */
export function sectionAnsweredCount(
  section: InstrumentSection,
  answers: InstrumentAnswers,
): number {
  return section.questions.filter((question) => typeof answers[question.id] === 'number').length;
}
