/**
 * Type definitions for the EEG emotion induction paradigm. This module is the
 * bottom of the paradigm dependency graph: it must not import from
 * ../types.ts (or any other EEG module) so ../types.ts can reuse ParadigmInfo
 * without a cycle.
 *
 * All backend IPC payloads are camelCase JSON and the field names mirror the
 * Rust contract one-to-one.
 */

/** Session variants offered on the acquisition page (A/B). */
export type ParadigmSessionKind = 'personal_calibration' | 'held_out_generation';

/** Full studySession union accepted by the backend ParadigmInfo. */
export type ParadigmStudySession = ParadigmSessionKind | 'regulation_feedback';

/**
 * R8 (大纲 6.1): fear is a first-class induction class. 'happy' is retired
 * from every schedule but stays on the union so pre-R8 trial records,
 * summaries, and legacy libraries keep parsing (mirrors the Rust enum).
 */
export type ParadigmEmotion = 'depression' | 'anxiety' | 'calm' | 'fear' | 'happy';

/** Wire values mirror the Rust trigger_code layout (fear took over slot 5). */
export type ParadigmTriggerClass = 1 | 2 | 3 | 4 | 5;

export type TrialQuality = 'accepted' | 'uncertain' | 'rejected' | 'artifact_rejected';

export type TrialMarkKind = 'pre_video_hint' | 'video' | 'post_video_rest';

export type TrialLabelSource =
  | 'induction_target'
  | 'self_report_confirmed'
  | 'model_prediction';

export type SelfReport = {
  valence: number;
  arousal: number;
  dominance?: number;
};

/** Attached to start_eeg_recording when the session is a paradigm run. */
export type ParadigmInfo = {
  studySession: ParadigmStudySession;
  subjectId: string;
  sessionRunId: string;
};

export type ParadigmVideoEntry = {
  videoId: string;
  fileName: string;
  absolutePath: string;
};

export type ParadigmVideoLibrary = {
  rootPath: string;
  depression: ParadigmVideoEntry[];
  anxiety: ParadigmVideoEntry[];
  calm: ParadigmVideoEntry[];
  fear: ParadigmVideoEntry[];
  /** Legacy pool (Happy retired in R8): present only for old libraries. */
  happy: ParadigmVideoEntry[];
  valid: boolean;
  problems: string[];
};

export type ParadigmTrialPlanItem = {
  trialIndex: number;
  emotion: ParadigmEmotion;
  triggerClass: ParadigmTriggerClass;
  videoId: string;
  videoPath: string;
};

export type TrialSnapshotMark = {
  mark: TrialMarkKind;
  sampleIndex: number;
  timestamp: string;
};

export type TrialHardwareTrigger = {
  code: number;
  sampleIndex: number;
  timestamp: string;
};

export type TrialSnapshot = {
  trialIndex: number;
  emotion: ParadigmEmotion;
  triggerClass: ParadigmTriggerClass;
  videoId: string;
  videoPath: string;
  eegStartSampleIndex: number;
  eegStartTs: string;
  eegEndSampleIndex: number | null;
  eegEndTs: string | null;
  marks: TrialSnapshotMark[];
  hardwareTriggers: TrialHardwareTrigger[];
  triggerStartTs: string | null;
  triggerEndTs: string | null;
};

/** Result of finalize_eeg_trial; snapshot fields plus the review payload. */
export type TrialRecord = TrialSnapshot & {
  selfReport: SelfReport | null;
  quality: TrialQuality | null;
  artifactFlags: string[];
  operatorNotes: string | null;
  labelSource: TrialLabelSource | null;
};

export type ParadigmSessionClassSummary = {
  emotion: ParadigmEmotion;
  accepted: number;
  uncertain: number;
  rejected: number;
  artifactRejected: number;
  interrupted: number;
};

export type ParadigmSessionSummary = {
  sessionId: string;
  totalTrials: number;
  perClass: ParadigmSessionClassSummary[];
  valenceMean: number | null;
  arousalMean: number | null;
  warnings: string[];
};

/** Chinese display labels for the induction targets (happy: legacy records). */
export const paradigmEmotionLabels: Record<ParadigmEmotion, string> = {
  anxiety: '焦虑',
  calm: '平静',
  depression: '抑郁',
  fear: '恐惧',
  happy: '快乐',
};

/** Chinese display labels for operator-facing quality states. */
export const trialQualityLabels: Record<TrialQuality, string> = {
  accepted: '接纳',
  artifact_rejected: '伪迹拒收',
  rejected: '拒收',
  uncertain: '不确定',
};

/** Chinese display labels for the two session kinds. */
export const paradigmSessionKindLabels: Record<ParadigmSessionKind, string> = {
  held_out_generation: 'Session B 独立诱发调控',
  personal_calibration: 'Session A 个人校准',
};

/** Artifact flag ids the operator can attach to a trial review. */
export const PARADIGM_ARTIFACT_FLAGS = [
  'trigger_missing',
  'eeg_gap',
  'video_playback_failure',
  'video_duration_out_of_range',
  'channel_offline',
  'motion_artifact',
  'other',
] as const;

export type ParadigmArtifactFlag = (typeof PARADIGM_ARTIFACT_FLAGS)[number];

/** Chinese display labels for the artifact flags. */
export const paradigmArtifactFlagLabels: Record<ParadigmArtifactFlag, string> = {
  trigger_missing: 'Trigger 缺失',
  eeg_gap: 'EEG 数据断档',
  video_playback_failure: '视频播放异常',
  video_duration_out_of_range: '视频时长越界',
  channel_offline: '通道掉线',
  motion_artifact: '动作伪迹',
  other: '其他伪迹',
};

export const PARADIGM_EMOTIONS: readonly ParadigmEmotion[] = [
  'depression',
  'anxiety',
  'calm',
  'fear',
  'happy',
];

/** Trials collected per emotion block; mirrors the Rust TRIALS_PER_CLASS. */
export const PARADIGM_TRIALS_PER_CLASS = 5;

/**
 * Block schedule mirroring the Rust blocks_for_session_kind: personal
 * calibration collects only the calm baseline block; the held-out generation
 * run induces anxiety, depression, and fear in order (R8, 大纲 6.1; happy
 * retired from every schedule).
 */
export const PARADIGM_BLOCKS_BY_KIND: Record<ParadigmSessionKind, readonly ParadigmEmotion[]> = {
  personal_calibration: ['calm'],
  held_out_generation: ['anxiety', 'depression', 'fear'],
};

/** Display order for the setup page (calm first, then the induction classes). */
export const PARADIGM_EMOTION_DISPLAY_ORDER: readonly ParadigmEmotion[] = [
  ...PARADIGM_BLOCKS_BY_KIND.personal_calibration,
  ...PARADIGM_BLOCKS_BY_KIND.held_out_generation,
];

/**
 * Wire trigger codes mirroring the Rust trigger_code: fear took the new slot
 * 5 in R8; happy keeps its historical 4 for legacy record compatibility.
 */
export const PARADIGM_TRIGGER_CLASSES: Record<ParadigmEmotion, ParadigmTriggerClass> = {
  anxiety: 2,
  calm: 3,
  depression: 1,
  fear: 5,
  happy: 4,
};
