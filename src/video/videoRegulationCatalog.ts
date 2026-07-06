import type { CompactTagOption } from '../music/musicRegulationTags';

export type VideoSelectionStep = 'atmosphere' | 'scene' | 'tag';

export type VideoRegulationSelections = Record<VideoSelectionStep, string>;

export type VideoRegulationAsset = {
  id: string;
  durationLabel: string;
  hasWater: boolean;
  indexedTags: string[];
  segment: Omit<LibrarySegment, 'file' | 'source'>;
  sourcePath: string;
  summary: string;
  tags: string[];
  title: string;
};

type LibrarySegment = {
  atmosphere: string;
  colorTone: string;
  file: string;
  hasWater: boolean;
  scene: string;
  source: string;
  tags: string[];
  weather: string;
};

function toWindowsPath(path: string) {
  return path.replace(/\//g, '\\');
}

export const videoLibraryPath = `${toWindowsPath(__TAURI_EEG_PROJECT_ROOT__)}\\video_database`;

export const videoSelectionSteps = ['tag', 'atmosphere', 'scene'] as const;

export const videoSelectionStepLabels = {
  atmosphere: '氛围',
  scene: '场景',
  tag: '标签',
} as const satisfies Record<VideoSelectionStep, string>;

const librarySegments: readonly LibrarySegment[] = [
  {
    atmosphere: '清幽静谧',
    colorTone: '翠绿调',
    file: '14_seg000.mp4',
    hasWater: false,
    scene: '密林深处',
    source: '14.mp4',
    tags: ['密林', '翠绿', '清幽', '树木', '自然'],
    weather: '阴天',
  },
  {
    atmosphere: '壮阔悠远',
    colorTone: '灰蓝调',
    file: '18_seg000.mp4',
    hasWater: true,
    scene: '海岸云天',
    source: '18.mp4',
    tags: ['海岸', '云天', '壮阔', '灰蓝', '暮色'],
    weather: '多云',
  },
  {
    atmosphere: '温暖宁静',
    colorTone: '暖蓝调',
    file: '18_seg001.mp4',
    hasWater: true,
    scene: '海岸暮色',
    source: '18.mp4',
    tags: ['海岸', '暮色', '温暖', '暖蓝', '云霞'],
    weather: '黄昏',
  },
  {
    atmosphere: '神秘幽深',
    colorTone: '翠绿调',
    file: '31_seg000.mp4',
    hasWater: false,
    scene: '浓雾密林',
    source: '31.mp4',
    tags: ['密林', '浓雾', '神秘', '翠绿', '幽深'],
    weather: '浓雾',
  },
  {
    atmosphere: '清新自然',
    colorTone: '青绿调',
    file: '46_seg000.mp4',
    hasWater: false,
    scene: '山林植被',
    source: '46.mp4',
    tags: ['山林', '植被', '清新', '青绿', '自然'],
    weather: '阴天',
  },
  {
    atmosphere: '宁静致远',
    colorTone: '冷蓝调',
    file: '9_seg000.mp4',
    hasWater: true,
    scene: '海天一色',
    source: '9.mp4',
    tags: ['海景', '晨雾', '宁静', '冷蓝调', '船帆'],
    weather: '晨雾朦胧',
  },
  {
    atmosphere: '沉静内敛',
    colorTone: '灰蓝调',
    file: '9_seg001.mp4',
    hasWater: true,
    scene: '阴天海景',
    source: '9.mp4',
    tags: ['海景', '阴天', '沉静', '灰蓝调', '水面'],
    weather: '阴天',
  },
  {
    atmosphere: '粗犷自然',
    colorTone: '灰调',
    file: '9_seg002.mp4',
    hasWater: true,
    scene: '海岸礁石',
    source: '9.mp4',
    tags: ['海岸', '礁石', '浪花', '阴天', '粗犷'],
    weather: '阴天',
  },
  {
    atmosphere: '开阔舒畅',
    colorTone: '暖棕调',
    file: '9_seg003.mp4',
    hasWater: true,
    scene: '海滩山景',
    source: '9.mp4',
    tags: ['海滩', '远山', '薄雾', '开阔', '暖调'],
    weather: '薄雾',
  },
  {
    atmosphere: '苍凉壮美',
    colorTone: '灰绿调',
    file: '9_seg004.mp4',
    hasWater: true,
    scene: '礁石海岸',
    source: '9.mp4',
    tags: ['海岸', '礁石', '阴天', '苍凉', '浪花'],
    weather: '阴天',
  },
  {
    atmosphere: '温暖治愈',
    colorTone: '金黄调',
    file: '9_seg005.mp4',
    hasWater: false,
    scene: '秋叶金黄',
    source: '9.mp4',
    tags: ['秋叶', '金黄', '温暖', '治愈', '森林'],
    weather: '晴朗',
  },
  {
    atmosphere: '平静悠远',
    colorTone: '灰调',
    file: '9_seg006.mp4',
    hasWater: true,
    scene: '海岸远眺',
    source: '9.mp4',
    tags: ['海岸', '阴天', '平静', '远眺', '礁石'],
    weather: '阴天',
  },
  {
    atmosphere: '清幽静谧',
    colorTone: '翠绿调',
    file: '9_seg007.mp4',
    hasWater: false,
    scene: '薄雾森林',
    source: '9.mp4',
    tags: ['森林', '薄雾', '清幽', '翠绿', '树木'],
    weather: '薄雾',
  },
  {
    atmosphere: '深沉静谧',
    colorTone: '暗棕调',
    file: '9_seg008.mp4',
    hasWater: false,
    scene: '暗调森林',
    source: '9.mp4',
    tags: ['森林', '暗调', '深沉', '树木', '幽暗'],
    weather: '阴暗',
  },
  {
    atmosphere: '空灵悠远',
    colorTone: '蓝灰调',
    file: '9_seg009.mp4',
    hasWater: false,
    scene: '山谷薄雾',
    source: '9.mp4',
    tags: ['山谷', '薄雾', '空灵', '蓝灰', '远眺'],
    weather: '薄雾',
  },
  {
    atmosphere: '壮阔磅礴',
    colorTone: '暗蓝调',
    file: '9_seg010.mp4',
    hasWater: true,
    scene: '风雨海景',
    source: '9.mp4',
    tags: ['海景', '风雨', '壮阔', '暗蓝', '云层'],
    weather: '阴天风雨',
  },
  {
    atmosphere: '清新自然',
    colorTone: '翠绿调',
    file: '9_seg011.mp4',
    hasWater: false,
    scene: '山林薄雾',
    source: '9.mp4',
    tags: ['山林', '薄雾', '清新', '翠绿', '植被'],
    weather: '薄雾',
  },
  {
    atmosphere: '朦胧梦幻',
    colorTone: '灰蓝调',
    file: '9_seg012.mp4',
    hasWater: false,
    scene: '雾锁群山',
    source: '9.mp4',
    tags: ['群山', '浓雾', '朦胧', '灰蓝', '层叠'],
    weather: '浓雾',
  },
  {
    atmosphere: '素雅宁静',
    colorTone: '灰调',
    file: '9_seg013.mp4',
    hasWater: true,
    scene: '海岸灰调',
    source: '9.mp4',
    tags: ['海岸', '阴天', '素雅', '灰调', '礁石'],
    weather: '阴天',
  },
  {
    atmosphere: '神秘幽深',
    colorTone: '翠绿调',
    file: '9_seg014.mp4',
    hasWater: false,
    scene: '浓雾森林',
    source: '9.mp4',
    tags: ['森林', '浓雾', '神秘', '翠绿', '幽深'],
    weather: '浓雾',
  },
  {
    atmosphere: '悠远宁静',
    colorTone: '蓝灰调',
    file: '9_seg015.mp4',
    hasWater: false,
    scene: '山谷云雾',
    source: '9.mp4',
    tags: ['山谷', '云雾', '悠远', '蓝灰', '宁静'],
    weather: '薄雾',
  },
  {
    atmosphere: '温柔浪漫',
    colorTone: '暖蓝调',
    file: '9_seg016.mp4',
    hasWater: true,
    scene: '暮色海岸',
    source: '9.mp4',
    tags: ['海岸', '黄昏', '温柔', '暖蓝', '码头'],
    weather: '黄昏',
  },
  {
    atmosphere: '开阔壮美',
    colorTone: '灰蓝调',
    file: '9_seg017.mp4',
    hasWater: false,
    scene: '天际云海',
    source: '9.mp4',
    tags: ['天际', '云海', '开阔', '灰蓝', '地平线'],
    weather: '多云',
  },
  {
    atmosphere: '平和安详',
    colorTone: '蓝灰调',
    file: '9_seg018.mp4',
    hasWater: true,
    scene: '平静海岸',
    source: '9.mp4',
    tags: ['海岸', '栈桥', '平静', '蓝灰', '薄雾'],
    weather: '薄雾',
  },
  {
    atmosphere: '温暖绚丽',
    colorTone: '暖紫调',
    file: '9_seg019.mp4',
    hasWater: false,
    scene: '山谷暮色',
    source: '9.mp4',
    tags: ['山谷', '暮色', '温暖', '紫调', '霞光'],
    weather: '黄昏',
  },
];

const assets = librarySegments.map(toVideoAsset);

function joinVideoLibraryPath(file: string) {
  return `${videoLibraryPath}\\${file}`;
}

function toVideoAsset(segment: LibrarySegment): VideoRegulationAsset {
  const id = segment.file.replace(/\.mp4$/i, '');
  const indexedTags = [
    segment.atmosphere,
    segment.colorTone,
    segment.file,
    segment.scene,
    segment.source,
    segment.weather,
    ...segment.tags,
  ];

  return {
    durationLabel: `${segment.source} / ${id}`,
    hasWater: segment.hasWater,
    id,
    indexedTags: Array.from(new Set(indexedTags)),
    segment: {
      atmosphere: segment.atmosphere,
      colorTone: segment.colorTone,
      hasWater: segment.hasWater,
      scene: segment.scene,
      tags: segment.tags,
      weather: segment.weather,
    },
    sourcePath: joinVideoLibraryPath(segment.file),
    summary: `${segment.scene}，${segment.weather}，${segment.atmosphere}，${segment.colorTone}`,
    tags: segment.tags,
    title: segment.scene,
  };
}

function getStepValue(video: VideoRegulationAsset, step: VideoSelectionStep) {
  if (step === 'tag') {
    return video.tags;
  }

  return video.segment[step];
}

function getOptionSourceVideos(
  selections: VideoRegulationSelections,
  step: VideoSelectionStep,
  libraryAssets: readonly VideoRegulationAsset[] = assets,
) {
  return libraryAssets.filter((video) =>
    videoSelectionSteps.every((candidateStep) => {
      if (candidateStep === step) {
        return true;
      }

      const selectedValue = selections[candidateStep];
      if (!selectedValue) {
        return true;
      }

      const value = getStepValue(video, candidateStep);
      return Array.isArray(value) ? value.includes(selectedValue) : value === selectedValue;
    }),
  );
}

export function getDefaultVideoSelections(): VideoRegulationSelections {
  return {
    atmosphere: '',
    scene: '',
    tag: '',
  };
}

export function getAllVideoRegulationAssets(
  libraryAssets: readonly VideoRegulationAsset[] = assets,
): VideoRegulationAsset[] {
  return [...libraryAssets];
}

export function getVideoRegulationCatalog(
  selections: VideoRegulationSelections = getDefaultVideoSelections(),
  libraryAssets: readonly VideoRegulationAsset[] = assets,
): VideoRegulationAsset[] {
  if (videoSelectionSteps.every((step) => selections[step].trim().length === 0)) {
    return [];
  }

  return libraryAssets.filter((video) =>
    videoSelectionSteps.every((step) => {
      const selectedValue = selections[step];

      if (!selectedValue) {
        return true;
      }

      const value = getStepValue(video, step);
      return Array.isArray(value) ? value.includes(selectedValue) : value === selectedValue;
    }),
  );
}

export function getVideoSelectionOptions(
  selections: VideoRegulationSelections,
  step: VideoSelectionStep,
  libraryAssets: readonly VideoRegulationAsset[] = assets,
): CompactTagOption[] {
  const values = getOptionSourceVideos(selections, step, libraryAssets).flatMap((video) => {
    const value = getStepValue(video, step);
    return Array.isArray(value) ? value : [value];
  });

  return Array.from(new Set(values)).map((value) => ({ label: value, value }));
}

export function getNextVideoSelectionStep(selections: VideoRegulationSelections): VideoSelectionStep | null {
  return videoSelectionSteps.find((step) => selections[step].trim().length === 0) ?? null;
}

export function selectFirstMatchedVideo(
  selections: VideoRegulationSelections,
  libraryAssets: readonly VideoRegulationAsset[] = assets,
) {
  return getVideoRegulationCatalog(selections, libraryAssets)[0] ?? null;
}

export function toPlayableVideoUrl(sourcePath: string, convertFileSrc?: (sourcePath: string) => string) {
  if (convertFileSrc) {
    return convertFileSrc(sourcePath);
  }

  if (/^[a-zA-Z]:\\/.test(sourcePath)) {
    return `file:///${sourcePath.replace(/\\/g, '/')}`;
  }

  return sourcePath;
}
