import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import type { CompactTagOption } from '../../music/musicRegulationTags';
import { videoSelectionStepLabels } from '../../video/videoRegulationCatalog';
import { getGroupedTagOptions } from './videoTagGroups';
import styles from './VideoRegulation.module.css';

/**
 * Tag selector presentation for the video regulation page: the single-select
 * button list, the dense collapsible group accordion (only one group open at
 * a time), and the labeled group shell that switches between the two.
 * Purely presentational — the selected value and handler come from the page.
 */

type TagButtonListProps = {
  colors: readonly string[];
  options: readonly CompactTagOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
};

function TagButtonList({ colors, options, selectedValue, onSelect }: TagButtonListProps) {
  return (
    <div className={`${styles.tagList} flex flex-wrap`}>
      {options.map((option, index) => {
        const selected = selectedValue === option.value;

        return (
          <button
            key={option.value}
            className={`${styles.tagButton} ${selected ? styles.activeTagButton : ''}`}
            style={{ '--tag-color': colors[index % colors.length] } as CSSProperties}
            type="button"
            onClick={() => onSelect(option.value)}
          >
            <span aria-hidden="true" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

type TagGroupSectionsProps = {
  colors: readonly string[];
  options: readonly CompactTagOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
};

function TagGroupSections({ colors, options, selectedValue, onSelect }: TagGroupSectionsProps) {
  const groups = useMemo(() => getGroupedTagOptions(options), [options]);
  const selectedGroupLabel = groups.find((group) => (
    group.options.some((option) => option.value === selectedValue)
  ))?.label;
  const fallbackGroupLabel = groups[0]?.label ?? '';
  const [openTagGroupLabel, setOpenTagGroupLabel] = useState(selectedGroupLabel ?? fallbackGroupLabel);

  useEffect(() => {
    setOpenTagGroupLabel(selectedGroupLabel ?? fallbackGroupLabel);
  }, [fallbackGroupLabel, selectedGroupLabel]);

  const handleAccordionSummaryClick = (
    event: MouseEvent<HTMLElement>,
    groupLabel: string,
  ) => {
    event.preventDefault();
    setOpenTagGroupLabel(groupLabel);
  };

  return (
    <div className={`${styles.tagGroupSections} grid`}>
      {groups.map((group) => (
        <details
          key={group.label}
          className={styles.tagGroupSection}
          open={openTagGroupLabel === group.label}
        >
          <summary
            className={`${styles.tagGroupSummary} flex items-center justify-between`}
            onClick={(event) => handleAccordionSummaryClick(event, group.label)}
          >
            <span>{group.label}</span>
            <strong>{group.options.length} 项</strong>
          </summary>
          <TagButtonList
            colors={colors}
            options={group.options}
            selectedValue={selectedValue}
            onSelect={onSelect}
          />
        </details>
      ))}
    </div>
  );
}

type TagGroupProps = {
  colors: readonly string[];
  label: string;
  options: readonly CompactTagOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
};

export function TagGroup({ colors, label, options, selectedValue, onSelect }: TagGroupProps) {
  return (
    <section className={`${styles.tagGroup} grid`} aria-label={label}>
      <div className={`${styles.tagGroupHeader} flex items-center justify-between`}>
        <span>{label}</span>
        <strong>{options.length} 项</strong>
      </div>
      {label === videoSelectionStepLabels.tag ? (
        <TagGroupSections
          colors={colors}
          options={options}
          selectedValue={selectedValue}
          onSelect={onSelect}
        />
      ) : (
        <TagButtonList
          colors={colors}
          options={options}
          selectedValue={selectedValue}
          onSelect={onSelect}
        />
      )}
    </section>
  );
}
