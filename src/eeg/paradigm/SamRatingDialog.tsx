import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent } from 'react';
import DevAutoFillButton, { type ScaleFillItem } from '../../mentalScale/scaleUi/DevAutoFillButton';
import ScaleAnchorGroup from '../../mentalScale/scaleUi/ScaleAnchorGroup';
import type { SelfReport } from './types';
import styles from './ParadigmSession.module.css';

type Props = {
  /** 1-based position of the just-watched video inside its block. */
  videoNumber: number;
  videosInBlock: number;
  onSubmit: (selfReport: SelfReport) => void;
};

type RatingRowKey = 'valence' | 'arousal' | 'dominance';

/** SAM bipolar range (doc scale-instruments.md §2.4): 1-9 per dimension. */
const RATING_MIN = 1;
const RATING_MAX = 9;

const valenceScaleHints: Record<number, string> = {
  1: '非常负性',
  5: '中性',
  9: '非常正性',
};

const arousalScaleHints: Record<number, string> = {
  1: '非常平静',
  5: '一般',
  9: '非常激动',
};

const dominanceScaleHints: Record<number, string> = {
  1: '非常被动',
  5: '一般',
  9: '非常主动',
};

type RatingRowProps = {
  legend: string;
  /** Chinese pole labels bracketing the 1-9 rail (from the hint copy). */
  lowLabel: string;
  highLabel: string;
  value: number | null;
  hints: Record<number, string>;
  onSelect: (value: number) => void;
  /** Row-scoped shortcuts: digits 1-9 pick and advance, Enter submits. */
  onKeyDown: (event: KeyboardEvent<HTMLFieldSetElement>) => void;
  registerOptionsContainer: (node: HTMLDivElement | null) => void;
  autoFocusFirstOption?: boolean;
};

/**
 * One SAM dimension: the legend (frozen copy) above the shared bipolar
 * anchor row, so the visuals match the battery dialog's SAM section. The
 * registered wrapper div keeps being the focus target of the digit flow.
 */
function RatingRow({
  legend,
  lowLabel,
  highLabel,
  value,
  hints,
  onSelect,
  onKeyDown,
  registerOptionsContainer,
  autoFocusFirstOption = false,
}: RatingRowProps) {
  return (
    <fieldset className={styles.ratingRow} onKeyDown={onKeyDown}>
      <legend className={styles.ratingLegend}>{legend}</legend>
      <div ref={registerOptionsContainer}>
        <ScaleAnchorGroup
          layout="bipolar"
          minValue={RATING_MIN}
          maxValue={RATING_MAX}
          lowLabel={lowLabel}
          highLabel={highLabel}
          value={value ?? undefined}
          onSelect={onSelect}
          ariaLabel={legend}
          valueHints={hints}
          autoFocusFirst={autoFocusFirstOption}
        />
      </div>
    </fieldset>
  );
}

export default function SamRatingDialog({
  videoNumber,
  videosInBlock,
  onSubmit,
}: Props) {
  const [valence, setValence] = useState<number | null>(null);
  const [arousal, setArousal] = useState<number | null>(null);
  const [dominance, setDominance] = useState<number | null>(null);
  const [isDominanceOpen, setIsDominanceOpen] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const optionContainersRef = useRef(new Map<RatingRowKey, HTMLDivElement>());
  const isReady = valence !== null && arousal !== null;

  // Visible rating rows in focus order; dominance only counts once expanded.
  const visibleRowKeys: readonly RatingRowKey[] = isDominanceOpen
    ? ['valence', 'arousal', 'dominance']
    : ['valence', 'arousal'];

  const handleSubmit = () => {
    if (!isReady || valence === null || arousal === null) {
      return;
    }

    // Raw 1-9 scores are forwarded untouched; the backend stores them as-is.
    onSubmit(dominance === null
      ? { valence, arousal }
      : { valence, arousal, dominance });
  };

  const selectForRow = (rowKey: RatingRowKey) => {
    if (rowKey === 'valence') {
      return setValence;
    }

    return rowKey === 'arousal' ? setArousal : setDominance;
  };

  const focusRow = (rowKey: RatingRowKey) => {
    optionContainersRef.current.get(rowKey)
      ?.querySelector<HTMLButtonElement>('button')
      ?.focus();
  };

  // Digit flow: after a row answers, jump to the next visible row; past the
  // last row, land on the submit button so Enter finishes the report.
  const advanceFocusAfter = (rowKey: RatingRowKey) => {
    const index = visibleRowKeys.indexOf(rowKey);
    if (index === -1) {
      return;
    }

    const nextRowKey = visibleRowKeys[index + 1];
    if (nextRowKey) {
      focusRow(nextRowKey);
    } else {
      submitButtonRef.current?.focus();
    }
  };

  const handleRowKeyDown = (rowKey: RatingRowKey) =>
    (event: KeyboardEvent<HTMLFieldSetElement>) => {
      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        selectForRow(rowKey)(Number(event.key));
        advanceFocusAfter(rowKey);
        return;
      }

      if (event.key === 'Enter' && isReady) {
        // Suppress the focused option's native activation so submission
        // fires exactly once instead of re-selecting the same value.
        event.preventDefault();
        handleSubmit();
      }
    };

  const registerOptionsContainer = (rowKey: RatingRowKey) =>
    (node: HTMLDivElement | null) => {
      if (node) {
        optionContainersRef.current.set(rowKey, node);
      } else {
        optionContainersRef.current.delete(rowKey);
      }
    };

  // Dev-only auto-fill: visible rows only (a hidden dominance row must not
  // receive data), riding the same per-row setters as manual clicks.
  const fillItems: ScaleFillItem[] = visibleRowKeys.map((rowKey) => ({
    id: rowKey,
    minValue: RATING_MIN,
    maxValue: RATING_MAX,
  }));
  const answeredRowIds = visibleRowKeys.filter((rowKey) => {
    if (rowKey === 'valence') {
      return valence !== null;
    }

    return rowKey === 'arousal' ? arousal !== null : dominance !== null;
  });
  const handleClearRatings = () => {
    setValence(null);
    setArousal(null);
    setDominance(null);
  };

  // Modal focus trap: keep Tab cycling within the dialog.
  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('button:not(:disabled)'),
    );
    if (focusable.length === 0) {
      return;
    }

    event.preventDefault();
    const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey
      ? (activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1)
      : (activeIndex === -1 || activeIndex === focusable.length - 1 ? 0 : activeIndex + 1);
    focusable[nextIndex].focus();
  };

  // Portal to <body> so the fixed overlay can never be trapped by an
  // ancestor stacking context or turned panel-relative by a retained
  // animation transform.
  return createPortal(
    <div className={`${styles.dialogOverlay} fixed inset-0 flex items-center justify-center p-22px`} role="presentation">
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sam-rating-title"
        ref={dialogRef}
        onKeyDown={handleDialogKeyDown}
      >
        <header className={styles.dialogHeader}>
          <p className={styles.dialogEyebrow}>情绪自评</p>
          <h2 className={styles.dialogTitle} id="sam-rating-title">
            刚才的视频让你感觉如何?
          </h2>
          <p className={styles.dialogDescription}>
            第 {videoNumber} / {videosInBlock} 个视频 · 请按真实感受评分
          </p>
        </header>

        <RatingRow
          legend="愉悦度(1 非常负性 ~ 9 非常正性)"
          lowLabel={valenceScaleHints[1]}
          highLabel={valenceScaleHints[9]}
          value={valence}
          hints={valenceScaleHints}
          onSelect={setValence}
          onKeyDown={handleRowKeyDown('valence')}
          registerOptionsContainer={registerOptionsContainer('valence')}
          autoFocusFirstOption
        />

        <RatingRow
          legend="唤醒度(1 非常平静 ~ 9 非常激动)"
          lowLabel={arousalScaleHints[1]}
          highLabel={arousalScaleHints[9]}
          value={arousal}
          hints={arousalScaleHints}
          onSelect={setArousal}
          onKeyDown={handleRowKeyDown('arousal')}
          registerOptionsContainer={registerOptionsContainer('arousal')}
        />

        {isDominanceOpen ? (
          <RatingRow
            legend="优势感,选填(1 非常被动 ~ 9 非常主动)"
            lowLabel={dominanceScaleHints[1]}
            highLabel={dominanceScaleHints[9]}
            value={dominance}
            hints={dominanceScaleHints}
            onSelect={setDominance}
            onKeyDown={handleRowKeyDown('dominance')}
            registerOptionsContainer={registerOptionsContainer('dominance')}
          />
        ) : (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => setIsDominanceOpen(true)}
          >
            展开优势感评分(选填)
          </button>
        )}

        <footer className={styles.dialogFooter}>
          <DevAutoFillButton
            items={fillItems}
            answeredIds={answeredRowIds}
            onAnswer={(rowId, value) => selectForRow(rowId as RatingRowKey)(value)}
            onClear={handleClearRatings}
          />
          <span className={styles.dialogFooterHint}>
            {isReady ? '两项必选评分已完成。' : '请先完成愉悦度与唤醒度评分。'}
          </span>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!isReady}
            ref={submitButtonRef}
            onClick={handleSubmit}
          >
            提交自评
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
