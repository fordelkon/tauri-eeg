import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import type { CSSProperties } from 'react';
import { getCompactTagSummary, type CompactTagOption } from '../../music/musicRegulationTags';
import styles from './MusicRegulation.module.css';

/**
 * Tag prompt-builder controls for the music regulation page: the compact
 * collapsed selector pill and the full-screen tag editor sheet. Purely
 * presentational — selection state and handlers come from the page.
 */

type CompactTagSelectorProps = {
  id: string;
  label: string;
  options: readonly CompactTagOption[];
  isOpen: boolean;
  selectedValues: string[];
  colors: readonly string[];
  customValue?: string;
  onOpenChange: (id: string) => void;
};

export function CompactTagSelector({
  id,
  label,
  options,
  isOpen,
  selectedValues,
  colors,
  customValue,
  onOpenChange,
}: CompactTagSelectorProps) {
  const summary = getCompactTagSummary(
    options,
    selectedValues,
    customValue ? { custom: customValue } : undefined,
  );

  return (
    <div className={styles.tagSelector}>
      <button
        className={styles.tagTrigger}
        type="button"
        aria-expanded={isOpen}
        onClick={() => onOpenChange(id)}
      >
        <span className={styles.tagDotStack} aria-hidden="true">
          {options.map((option, index) => (
            <span
              key={option.value}
              className={selectedValues.includes(option.value) ? styles.activeTagDot : ''}
              style={{ '--tag-color': colors[index % colors.length] } as CSSProperties}
            />
          ))}
        </span>
        <span className={styles.tagTriggerText}>{label}</span>
        <span className={styles.tagCount}>{summary.countLabel}</span>
        <span className={`${styles.tagChevron} ${isOpen ? styles.tagChevronOpen : ''}`} aria-hidden="true" />
      </button>
    </div>
  );
}

type TagEditorSheetProps = {
  title: string;
  options: readonly CompactTagOption[];
  selectedValues: string[];
  colors: readonly string[];
  customPlaceholder?: string;
  customValue?: string;
  onClose: () => void;
  onCustomChange?: (value: string) => void;
  onOnly: (value: string) => void;
  onToggle: (value: string) => void;
};

export function TagEditorSheet({
  title,
  options,
  selectedValues,
  colors,
  customPlaceholder,
  customValue,
  onClose,
  onCustomChange,
  onOnly,
  onToggle,
}: TagEditorSheetProps) {
  const summary = getCompactTagSummary(
    options,
    selectedValues,
    customValue ? { custom: customValue } : undefined,
  );

  return (
    <div className={`${styles.tagSheetOverlay} fixed inset-0 z-20 flex`} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <section className={styles.tagSheet} aria-label={`${title}标签`}>
        <div className={styles.tagSheetHeader}>
          <div>
            <span>{title}</span>
            <strong>{summary.label}</strong>
          </div>
          <button className={styles.tagSheetClose} type="button" aria-label="关闭标签编辑器" onClick={onClose}>
            <CloseRoundedIcon fontSize="small" />
          </button>
        </div>

        <div className={styles.tagSheetList}>
          {options.map((option, index) => {
            const isSelected = selectedValues.includes(option.value);

            return (
              <div key={option.value} className={styles.tagMenuItem}>
                <label className={styles.tagMenuToggle}>
                  <input
                    checked={isSelected}
                    type="checkbox"
                    value={option.value}
                    onChange={() => onToggle(option.value)}
                  />
                  <span className={styles.tagCheck} aria-hidden="true" />
                  <span
                    className={`${styles.tagOptionDot} ${isSelected ? styles.activeTagOptionDot : ''}`}
                    style={{ '--tag-color': colors[index % colors.length] } as CSSProperties}
                    aria-hidden="true"
                  />
                  <span className={styles.tagOptionLabel}>{option.label}</span>
                </label>
                <button
                  className={styles.tagOnlyButton}
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    onOnly(option.value);
                  }}
                >
                  仅选
                </button>
                {option.value === 'custom' && isSelected ? (
                  <input
                    className={styles.tagCustomInput}
                    value={customValue || ''}
                    maxLength={80}
                    onChange={(event) => onCustomChange?.(event.currentTarget.value)}
                    placeholder={customPlaceholder}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
