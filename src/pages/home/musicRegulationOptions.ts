import type { CompactTagOption } from '../../music/musicRegulationTags';

/**
 * Pure prompt-builder data for the music regulation page (tag option tables,
 * per-selector palettes, planner-payload helpers). Kept free of React so the
 * agent prompt mapping stays unit-testable next to its options.
 */

export const bundledMusicFiles = [] as const;

export const instrumentOptions = [
  {
    label: '钢琴',
    value: 'piano',
  },
  {
    label: '小提琴',
    value: 'violin',
  },
  {
    label: '吉他',
    value: 'guitar',
  },
  {
    label: '大提琴',
    value: 'cello',
  },
  {
    label: '长笛',
    value: 'flute',
  },
  {
    label: '鼓组',
    value: 'drums',
  },
  {
    label: '贝斯',
    value: 'bass',
  },
  {
    label: '合成器',
    value: 'synthesizer',
  },
  {
    label: '萨克斯',
    value: 'saxophone',
  },
  {
    label: '其他',
    value: 'custom',
  },
] as const;

export const styleOptions = [
  {
    label: '氛围',
    value: 'ambient instrumental',
  },
  {
    label: '流行',
    value: 'pop instrumental',
  },
  {
    label: '摇滚',
    value: 'rock instrumental',
  },
  {
    label: '古典',
    value: 'classical instrumental',
  },
  {
    label: '冥想',
    value: 'meditation music',
  },
  {
    label: '低保真',
    value: 'lo-fi instrumental',
  },
  {
    label: '爵士',
    value: 'jazz instrumental',
  },
  {
    label: '电影感',
    value: 'cinematic instrumental',
  },
  {
    label: '其他',
    value: 'custom',
  },
] as const;

export const detailTemplateOptions = [
  {
    label: '慢速',
    value: 'slow tempo',
  },
  {
    label: '温暖音色',
    value: 'warm tone',
  },
  {
    label: '柔和节奏',
    value: 'soft rhythm',
  },
  {
    label: '平静质感',
    value: 'calm therapeutic texture',
  },
  {
    label: '轻混响',
    value: 'light reverb',
  },
  {
    label: '轻柔动态',
    value: 'gentle dynamics',
  },
  {
    label: '低频厚度',
    value: 'deep bass',
  },
  {
    label: '明亮旋律',
    value: 'bright melody',
  },
] as const;

export const instrumentTagColors = ['#6adfbb', '#ef6f61', '#f8a62b', '#5d8fe8', '#a78bfa', '#e26ca5', '#4fb2c6', '#8cc35f', '#d7a86e', '#9aa2a9'] as const;
export const styleTagColors = ['#6adfbb', '#ef6f61', '#f8a62b', '#5d8fe8', '#a78bfa', '#e26ca5', '#4fb2c6', '#8cc35f', '#d7a86e'] as const;
export const detailTagColors = ['#6adfbb', '#ef6f61', '#f8a62b', '#5d8fe8', '#a78bfa', '#e26ca5', '#4fb2c6', '#8cc35f'] as const;

export const generationDurationOptions = [15, 30, 60, 120] as const;

// Session-local cap for the generated history list (newest first), mirroring the
// backend's bounded history semantics so the list never grows without limit.
export const MAX_GENERATED_ITEMS = 100;

export type AgentMusicPromptDetail = {
  instrument?: string | null;
  style?: string | null;
  details?: string | null;
  duration?: number | null;
};

export function splitPlannerTags(value: string | null | undefined) {
  return (value ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/** Multi-select toggle for a tag layer's selected values. */
export function toggleTagSelection(values: readonly string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

export function selectTagValues(
  options: readonly CompactTagOption[],
  values: readonly (string | null | undefined)[],
  setCustomValue: (value: string) => void,
) {
  const optionValues = new Set(options.map((option) => option.value));
  const exactValues: string[] = [];
  const customValues: string[] = [];

  values.flatMap(splitPlannerTags).forEach((value) => {
    if (optionValues.has(value) && value !== 'custom') {
      exactValues.push(value);
      return;
    }

    customValues.push(value);
  });

  setCustomValue(customValues.join(', '));
  return customValues.length > 0 ? [...exactValues, 'custom'] : exactValues;
}

/** m:ss playback/elapsed label; non-finite or negative input clamps to 0:00. */
export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
