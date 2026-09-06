import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import styles from './scaleUi.module.css';

/** One fillable item: its answer key and the legal numeric range. */
export type ScaleFillItem = {
  id: string;
  minValue: number;
  maxValue: number;
};

/**
 * Pure random-fill builder: every UNANSWERED item gets one independent
 * Math.random() draw mapped to an integer inside its legal range. Answered
 * keys are never touched (the developer may keep picked values).
 */
export function buildRandomFill(
  items: ReadonlyArray<ScaleFillItem>,
  answeredIds: ReadonlyArray<string>,
): Record<string, number> {
  const answered = new Set(answeredIds);
  const fill: Record<string, number> = {};

  for (const item of items) {
    if (answered.has(item.id)) {
      continue;
    }

    const span = Math.max(1, item.maxValue - item.minValue + 1);
    fill[item.id] = item.minValue + Math.floor(Math.random() * span);
  }

  return fill;
}

/**
 * The exact body of the button's click handler: build the fill, then push
 * every value through the dialog's EXISTING per-item onChange/setter so the
 * regular validation path runs and the submit gate re-evaluates. Exported
 * for the node-env tests (no DOM is available to dispatch real clicks).
 */
export function applyRandomFill(
  items: ReadonlyArray<ScaleFillItem>,
  answeredIds: ReadonlyArray<string>,
  onAnswer: (id: string, value: number) => void,
): Record<string, number> {
  const fill = buildRandomFill(items, answeredIds);

  for (const [id, value] of Object.entries(fill)) {
    onAnswer(id, value);
  }

  return fill;
}

export type DevAutoFillButtonProps = {
  items: ReadonlyArray<ScaleFillItem>;
  /** Answer keys already set — the fill skips them. */
  answeredIds: ReadonlyArray<string>;
  /** The dialog's existing per-item onChange (same path as manual clicks). */
  onAnswer: (id: string, value: number) => void;
  /** Optional "清空" action (resets the answers through the dialog's setter). */
  onClear?: () => void;
};

/**
 * DEV-ONLY helper button. Hard visibility gate: import.meta.env.DEV is
 * statically false in production builds (vite define), so the component
 * renders null in production and the branch is dead-code-eliminated by the
 * minifier — it can never reach a built app.
 */
export default function DevAutoFillButton({
  items,
  answeredIds,
  onAnswer,
  onClear,
}: DevAutoFillButtonProps) {
  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <span className={`${styles.base} ${styles.devFillGroup}`}>
      <button
        type="button"
        className={styles.devFillButton}
        onClick={() => applyRandomFill(items, answeredIds, onAnswer)}
      >
        <BoltRoundedIcon aria-hidden="true" fontSize="inherit" />
        一键填写（开发）
      </button>
      {onClear ? (
        <button type="button" className={styles.devClearButton} onClick={onClear}>
          清空
        </button>
      ) : null}
    </span>
  );
}
