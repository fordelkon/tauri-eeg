import { invoke } from '@tauri-apps/api/core';
import type {
  ParadigmSessionKind,
  ParadigmSessionSummary,
  ParadigmTrialPlanItem,
  ParadigmVideoLibrary,
  SelfReport,
  TrialLabelSource,
  TrialMarkKind,
  TrialQuality,
  TrialRecord,
  TrialSnapshot,
} from './types';

export function loadParadigmVideoLibrary(rootPath: string) {
  return invoke<ParadigmVideoLibrary>('load_paradigm_video_library', {
    input: { rootPath },
  });
}

export function buildParadigmQueue(
  rootPath: string,
  sessionRunId: string,
  sessionKind: ParadigmSessionKind,
) {
  return invoke<ParadigmTrialPlanItem[]>('build_paradigm_queue', {
    input: { rootPath, sessionRunId, sessionKind },
  });
}

export function beginEegTrial(input: {
  trialIndex: number;
  videoId: string;
  videoPath: string;
  emotion: TrialSnapshot['emotion'];
}) {
  return invoke<TrialSnapshot>('begin_eeg_trial', { input });
}

export function markEegTrial(mark: TrialMarkKind) {
  return invoke<TrialSnapshot>('mark_eeg_trial', { input: { mark } });
}

export function endEegTrial() {
  return invoke<TrialSnapshot>('end_eeg_trial');
}

export type FinalizeEegTrialInput = {
  selfReport?: SelfReport;
  quality?: TrialQuality;
  artifactFlags: string[];
  operatorNotes?: string;
  labelSource?: TrialLabelSource;
};

export function finalizeEegTrial(input: FinalizeEegTrialInput) {
  return invoke<TrialRecord>('finalize_eeg_trial', { input });
}

export function getActiveParadigmTrial() {
  return invoke<TrialSnapshot | null>('get_active_paradigm_trial');
}

export function getParadigmSessionSummary(sessionId: string) {
  return invoke<ParadigmSessionSummary>('get_paradigm_session_summary', {
    input: { sessionId },
  });
}
