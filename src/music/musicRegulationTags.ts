export type CompactTagOption = {
  label: string;
  value: string;
};

export function getCompactTagSummary(
  options: readonly CompactTagOption[],
  selectedValues: readonly string[],
  customLabels: Readonly<Record<string, string>> = {},
) {
  const selectedLabels = options
    .filter((option) => selectedValues.includes(option.value))
    .map((option) => customLabels[option.value]?.trim() || option.label);

  return {
    countLabel: `${selectedLabels.length}/${options.length}`,
    label: selectedLabels.length > 0 ? selectedLabels.join(', ') : 'Choose tags',
  };
}

export function getNextOpenTagSelector(currentId: string | null, requestedId: string) {
  return currentId === requestedId ? null : requestedId;
}
