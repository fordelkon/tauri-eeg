export type ParadigmSessionKind = 'personal_calibration' | 'held_out_generation';
export type ParadigmEmotion = 'depression' | 'anxiety' | 'calm' | 'fear';
export type ParadigmTriggerClass = 1 | 2 | 3 | 5;
export type TrialQuality = 'accepted' | 'uncertain' | 'rejected' | 'artifact_rejected';
export type TrialLabelSource = 'induction_target' | 'self_report_confirmed';
export type SelfReport = { valence: number; arousal: number; dominance?: number };
export type ParadigmVideoEntry = { videoId: string; fileName: string; absolutePath: string };
export type ParadigmVideoLibrary = {
  rootPath: string;
  depression: ParadigmVideoEntry[];
  anxiety: ParadigmVideoEntry[];
  calm: ParadigmVideoEntry[];
  fear: ParadigmVideoEntry[];
  valid: boolean;
  problems: string[];
  readinessWarnings: string[];
};
export type ParadigmTrialPlanItem = {
  trialIndex: number;
  emotion: ParadigmEmotion;
  triggerClass: ParadigmTriggerClass;
  videoId: string;
  videoPath: string;
};
export type TrialSnapshot = ParadigmTrialPlanItem & {
  presentationStartedAt: string;
  presentationEndedAt: string | null;
};
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
export const paradigmEmotionLabels: Record<ParadigmEmotion, string> = {
  anxiety: '焦虑',
  calm: '平静',
  depression: '抑郁',
  fear: '恐惧',
};
export const trialQualityLabels: Record<TrialQuality, string> = {
  accepted: '接纳',
  artifact_rejected: '呈现异常拒收',
  rejected: '拒收',
  uncertain: '不确定',
};
export const paradigmSessionKindLabels: Record<ParadigmSessionKind, string> = {
  held_out_generation: '独立诱发',
  personal_calibration: '个人校准',
};
export const PARADIGM_EMOTIONS: readonly ParadigmEmotion[] = [
  'depression',
  'anxiety',
  'calm',
  'fear',
];
export const PARADIGM_TRIALS_PER_CLASS = 5;
export const PARADIGM_BLOCKS_BY_KIND: Record<ParadigmSessionKind, readonly ParadigmEmotion[]> = {
  personal_calibration: ['calm'],
  held_out_generation: ['anxiety', 'depression', 'fear'],
};
export const PARADIGM_EMOTION_DISPLAY_ORDER: readonly ParadigmEmotion[] = [
  'calm',
  'anxiety',
  'depression',
  'fear',
];
export const PARADIGM_TRIGGER_CLASSES: Record<ParadigmEmotion, ParadigmTriggerClass> = {
  anxiety: 2,
  calm: 3,
  depression: 1,
  fear: 5,
};
