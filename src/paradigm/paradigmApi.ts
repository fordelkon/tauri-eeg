import { invoke } from '@tauri-apps/api/core';
import type {
  ParadigmSessionKind,
  ParadigmTrialPlanItem,
  ParadigmVideoLibrary,
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
