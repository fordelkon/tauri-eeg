import type { CompactTagOption } from '../../music/musicRegulationTags';

/**
 * Grouping data for the video regulation page's dense tag step: the curated
 * tag groups (山林植被 / 水域海岸 / …) and the pure grouping helper that
 * buckets a catalog's options into those groups plus an 其他标签 remainder.
 */

type TagOptionGroup = {
  label: string;
  values: readonly string[];
};

export const tagOptionGroups: readonly TagOptionGroup[] = [
  {
    label: '山林植被',
    values: ['密林', '树木', '自然', '山林', '植被', '森林', '秋叶', '群山', '山谷'],
  },
  {
    label: '水域海岸',
    values: ['海岸', '海景', '海滩', '礁石', '浪花', '水面', '栈桥', '码头', '船帆'],
  },
  {
    label: '天气天空',
    values: ['阴天', '浓雾', '晨雾', '薄雾', '风雨', '云层', '云雾', '云海', '云天', '天际', '地平线', '霞光'],
  },
  {
    label: '色调光影',
    values: ['翠绿', '青绿', '灰蓝', '灰蓝调', '暖蓝', '暖调', '暗调', '暗蓝', '蓝灰', '灰调', '紫调', '金黄', '暮色', '黄昏'],
  },
  {
    label: '情绪氛围',
    values: [
      '清幽',
      '壮阔',
      '温暖',
      '神秘',
      '宁静',
      '沉静',
      '粗犷',
      '开阔',
      '苍凉',
      '治愈',
      '平静',
      '深沉',
      '幽暗',
      '空灵',
      '朦胧',
      '层叠',
      '素雅',
      '悠远',
      '温柔',
    ],
  },
] as const;

export function getGroupedTagOptions(options: readonly CompactTagOption[]) {
  const optionByValue = new Map(options.map((option) => [option.value, option]));
  const groupedValues = new Set<string>();
  const groups = tagOptionGroups
    .map((group) => {
      const groupOptions = group.values
        .map((value) => optionByValue.get(value))
        .filter((option): option is CompactTagOption => Boolean(option));

      groupOptions.forEach((option) => groupedValues.add(option.value));

      return {
        label: group.label,
        options: groupOptions,
      };
    })
    .filter((group) => group.options.length > 0);
  const otherOptions = options.filter((option) => !groupedValues.has(option.value));

  return otherOptions.length > 0
    ? [...groups, { label: '其他标签', options: otherOptions }]
    : groups;
}
