import type { CompactTagOption } from '../music/musicRegulationTags';

export type VideoRegulationSelections = {
  emotionTargets: string[];
  stimulusLevels: string[];
  videoTypes: string[];
};

export type VideoRegulationAsset = {
  id: string;
  durationLabel: string;
  sourcePath: string;
  summary: string;
  tags: VideoRegulationSelections;
  title: string;
};

export const emotionTargetOptions = [
  { label: 'Relaxation', value: 'relaxation' },
  { label: 'Reduce anxiety', value: 'reduce-anxiety' },
  { label: 'Improve mood', value: 'improve-mood' },
  { label: 'Focus', value: 'focus' },
  { label: 'Sleep prep', value: 'sleep-prep' },
] as const satisfies readonly CompactTagOption[];

export const videoTypeOptions = [
  { label: 'Nature', value: 'nature' },
  { label: 'Meditation', value: 'meditation' },
  { label: 'Urban slow', value: 'urban-slow' },
  { label: 'Rhythmic', value: 'rhythmic' },
  { label: 'Abstract visual', value: 'abstract-visual' },
] as const satisfies readonly CompactTagOption[];

export const stimulusLevelOptions = [
  { label: 'Low stimulus', value: 'low-stimulus' },
  { label: 'Medium stimulus', value: 'medium-stimulus' },
  { label: 'High stimulus', value: 'high-stimulus' },
  { label: 'No speech', value: 'no-speech' },
  { label: 'Background audio', value: 'background-audio' },
] as const satisfies readonly CompactTagOption[];

const seededVideo: VideoRegulationAsset = {
  durationLabel: 'Local MP4',
  id: 'seed-local-14',
  sourcePath: 'C:\\mp4_videos\\14.mp4',
  summary: 'Seed local video for the first regulation playback flow. Future scanning can replace this catalog entry.',
  tags: {
    emotionTargets: emotionTargetOptions.map((option) => option.value),
    stimulusLevels: stimulusLevelOptions.map((option) => option.value),
    videoTypes: videoTypeOptions.map((option) => option.value),
  },
  title: 'Local Regulation Video 14',
};

export function getDefaultVideoSelections(): VideoRegulationSelections {
  return {
    emotionTargets: ['relaxation'],
    stimulusLevels: ['low-stimulus'],
    videoTypes: ['nature'],
  };
}

export function getVideoRegulationCatalog(
  _selections: VideoRegulationSelections = getDefaultVideoSelections(),
): VideoRegulationAsset[] {
  return [seededVideo];
}

export function toPlayableVideoUrl(
  sourcePath: string,
  convertFileSrc?: (sourcePath: string) => string,
) {
  if (convertFileSrc) {
    return convertFileSrc(sourcePath);
  }

  if (/^[a-zA-Z]:\\/.test(sourcePath)) {
    return `file:///${sourcePath.replace(/\\/g, '/')}`;
  }

  return sourcePath;
}
