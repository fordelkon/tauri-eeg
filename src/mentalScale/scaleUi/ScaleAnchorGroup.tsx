import styles from './scaleUi.module.css';
import { type KeyboardEvent as ReactKeyboardEvent } from 'react';

/** One selectable anchor option of a row (value + optional Chinese label). */
export type ScaleAnchorOption = {
  value: number;
  label?: string;
};

type AnchorModelInput = {
  layout: 'discrete' | 'bipolar';
  minValue: number;
  /** Highest numeric value; bipolar only (discrete derives it from labels). */
  maxValue?: number;
  /** Chinese anchor labels ordered from minValue upward (discrete only). */
  anchorLabels?: readonly string[];
};

/**
 * Pure option model behind the anchor row. Exported so the node-environment
 * tests (this repo runs vitest without a DOM) can pin the three layouts:
 * discrete 0-3 / 1-4 / 1-5 and the bipolar 1-9 boundaries.
 */
export function buildAnchorOptions({
  layout,
  minValue,
  maxValue,
  anchorLabels = [],
}: AnchorModelInput): ScaleAnchorOption[] {
  if (layout === 'bipolar') {
    const top = maxValue ?? minValue;
    return Array.from(
      { length: Math.max(0, top - minValue + 1) },
      (_, index) => ({ value: minValue + index }),
    );
  }

  return anchorLabels.map((label, index) => ({ value: minValue + index, label }));
}

/**
 * The click-path of every anchor button (both layouts render buttons whose
 * onClick calls exactly this). Exported for the same node-env test reason as
 * buildAnchorOptions — no DOM is available to dispatch real clicks.
 */
export function selectAnchorValue(
  onSelect: (value: number) => void,
  option: ScaleAnchorOption,
): void {
  onSelect(option.value);
}

export type ScaleAnchorGroupProps = {
  /** 'discrete' = segmented numbered buttons; 'bipolar' = labelled 1-9 rail. */
  layout: 'discrete' | 'bipolar';
  minValue: number;
  maxValue?: number;
  anchorLabels?: readonly string[];
  /** Bipolar pole labels (SAM): text for the lowest/highest value. */
  lowLabel?: string;
  highLabel?: string;
  /** Current selection; undefined renders the row unanswered. */
  value?: number;
  onSelect: (value: number) => void;
  /** Accessible name of the group (the question text). */
  ariaLabel: string;
  /** Optional per-value aria hints, e.g. paradigm SAM "5(中性)". */
  valueHints?: Record<number, string>;
  /** Moves initial focus to the first button (paradigm valence row). */
  autoFocusFirst?: boolean;
};

/**
 * The shared anchor control of the scale dialogs. Discrete rows show only
 * numbers inside the buttons and render the selected value's Chinese label
 * BELOW the row (long 4-5 column labels would squeeze); bipolar rows bracket
 * a subtle gradient rail with the two Chinese pole labels.
 */
export default function ScaleAnchorGroup({
  layout,
  minValue,
  maxValue,
  anchorLabels,
  lowLabel,
  highLabel,
  value,
  onSelect,
  ariaLabel,
  valueHints,
  autoFocusFirst = false,
}: ScaleAnchorGroupProps) {
  const options = buildAnchorOptions({ layout, minValue, maxValue, anchorLabels });
  const isBipolar = layout === 'bipolar';
  const selected = options.find((option) => option.value === value);

  // Arrow-key navigation (audit 3): every anchor is a tabbable button, which
  // makes a 9-point bipolar row nine Tab stops. Arrows/Home/End move focus
  // AND select — the radiogroup convention — so a keyboard participant can
  // sweep a row without the mouse. Purely additive: click paths are unchanged
  // for every consumer (scale dialogs + paradigm SAM rows).
  const handleGroupKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (options.length === 0) {
      return;
    }

    const currentIndex = options.findIndex((option) => option.value === value);
    let nextIndex: number;

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (currentIndex <= 0 ? 0 : currentIndex - 1);
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = Math.min(options.length - 1, currentIndex + 1);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = options.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();

    const next = options[nextIndex];
    if (!next) {
      return;
    }

    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button');
    buttons[nextIndex]?.focus();
    selectAnchorValue(onSelect, next);
  };

  const buttons = options.map((option, index) => {
    const isSelected = option.value === value;
    const hint = valueHints?.[option.value];
    // Bipolar buttons name themselves after the hint copy when one exists
    // (paradigm rows), otherwise after the question text.
    const aria = isBipolar && hint
      ? `${option.value}(${hint})`
      : `${ariaLabel} ${option.value}`;

    return (
      <button
        key={option.value}
        type="button"
        autoFocus={autoFocusFirst && index === 0 ? true : undefined}
        className={`${styles.anchorButton} ${isBipolar ? styles.bipolarButton : ''} ${isSelected ? styles.anchorSelected : ''}`}
        aria-pressed={isSelected}
        aria-label={aria}
        onClick={() => selectAnchorValue(onSelect, option)}
      >
        {option.value}
      </button>
    );
  });

  return (
    <div
      className={`${styles.base} ${styles.anchorGroup}`}
      role="group"
      aria-label={ariaLabel}
      onKeyDown={handleGroupKeyDown}
    >
      {isBipolar ? (
        <div className={styles.bipolarRow}>
          {lowLabel ? <span className={styles.bipolarPoleLabel}>{lowLabel}</span> : null}
          <div className={styles.bipolarTrack}>{buttons}</div>
          {highLabel ? <span className={styles.bipolarPoleLabel}>{highLabel}</span> : null}
        </div>
      ) : (
        <div className={styles.anchorRow}>{buttons}</div>
      )}
      {!isBipolar ? (
        // Redundant for assistive tech (the pressed button already carries the
        // value), so the live label stays visual-only.
        <p
          className={`${styles.anchorValueLabel} ${selected ? '' : styles.anchorValueLabelMuted}`}
          aria-hidden="true"
        >
          {selected?.label ?? '—'}
        </p>
      ) : null}
    </div>
  );
}
