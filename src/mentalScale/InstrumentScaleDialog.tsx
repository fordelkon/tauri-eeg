import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton } from '@mui/material';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  isInstrumentSectionComplete,
  sectionAnsweredCount,
  type BatteryAnswers,
  type BatteryDefinition,
  type BatterySectionKey,
  type InstrumentAnswers,
} from './instruments/battery';
import DevAutoFillButton, { type ScaleFillItem } from './scaleUi/DevAutoFillButton';
import ScaleAnchorGroup from './scaleUi/ScaleAnchorGroup';
import ScaleItemRow from './scaleUi/ScaleItemRow';
import ScaleSectionHeader from './scaleUi/ScaleSectionHeader';
import ScaleProgressBar from './scaleUi/ScaleProgressBar';
import styles from './MentalScaleDialog.module.css';
import sectionStyles from './InstrumentScaleDialog.module.css';

type InstrumentScaleDialogProps = {
  /** The battery definition for this phase (optional SAM/GEMS sections per
   *  doc scale-instruments.md §3.3). */
  definition: BatteryDefinition;
  /** Receives the raw per-section answers {stai, panas, sam?, gems?}; scoring
   *  happens in the battery module, never in the dialog. */
  onComplete: (answers: BatteryAnswers) => void;
  onClose: () => void;
  /**
   * Effect-evaluation save-in-flight state (optional so older consumers keep
   * working): while true the submit button is busy, closing is blocked, and
   * the dialog STAYS OPEN so a completed 40+ item fill is never lost to a
   * failed save — the owner unmounts the dialog once the save succeeded.
   */
  isSubmitting?: boolean;
  /** Owner-side failure copy (e.g. the save request failed); rendered in the
   *  sticky footer so it is visible while the answers are still on screen. */
  submitError?: string | null;
};

type SectionAnswerState = {
  section: BatteryDefinition['sections'][number];
  answers: InstrumentAnswers;
};

/**
 * Multi-section dialog for the pre/post battery: a sticky total progress bar
 * on top, one sticky-headed section per instrument (STAI-S 1-4, PANAS 1-5,
 * optional SAM 1-9 bipolar rows, optional GEMS-9 1-5), and a sticky footer
 * whose submit stays disabled until every question of every section is
 * answered. Scoring, persistence and the answer contract stay untouched
 * (battery module + onComplete); what the dialog itself owns is modal
 * hygiene: focus moves in on open, Tab is trapped inside, Escape rides the
 * same guarded close as the X button (discard confirmation when answers
 * exist), focus returns to the trigger on close, and with `isSubmitting` the
 * dialog holds open (close blocked, submit busy) so a completed 40+ item
 * fill survives a failed save.
 */
export default function InstrumentScaleDialog({
  definition,
  onComplete,
  onClose,
  isSubmitting = false,
  submitError = null,
}: InstrumentScaleDialogProps) {
  const [answersBySection, setAnswersBySection] = useState<
    Partial<Record<BatterySectionKey, InstrumentAnswers>>
  >({});
  // Closing with answers already filled in asks for confirmation first; 40+
  // items are too much work to lose to one misclick.
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  // Focus management (audit 3/10): the overlay is a hand-rolled portal (not a
  // MUI Dialog), so it must move focus in on open, keep Tab cycling inside,
  // and hand focus back to the trigger on close — otherwise keyboard users
  // keep tabbing the page behind the modal.
  const dialogRef = useRef<HTMLElement | null>(null);
  const openerElementRef = useRef<Element | null>(null);
  const dialogRefCallback = (node: HTMLElement | null) => {
    if (node && dialogRef.current === null) {
      openerElementRef.current = document.activeElement;
      node.focus();
    }
    dialogRef.current = node;
  };

  useEffect(() => () => {
    const opener = openerElementRef.current;
    if (opener instanceof HTMLElement && opener.isConnected) {
      opener.focus();
    }
  }, []);

  const sectionStates: SectionAnswerState[] = definition.sections.map((section) => ({
    section,
    answers: answersBySection[section.key] ?? {},
  }));
  const isBatteryReady = sectionStates.every(
    ({ section, answers }) => isInstrumentSectionComplete(section, answers),
  );
  const hasAnyAnswer = sectionStates.some(({ answers }) => Object.keys(answers).length > 0);
  const answeredCount = sectionStates.reduce(
    (sum, { section, answers }) => sum + sectionAnsweredCount(section, answers),
    0,
  );
  const totalQuestions = sectionStates.reduce(
    (sum, { section }) => sum + section.questions.length,
    0,
  );

  const handleAnswer = (sectionKey: BatterySectionKey, questionId: string, value: number) => {
    setAnswersBySection((current) => ({
      ...current,
      [sectionKey]: { ...(current[sectionKey] ?? {}), [questionId]: value },
    }));
  };

  const handleCloseRequest = () => {
    // A save is in flight: closing now would either orphan it visually or
    // look like an abort that did not happen. Wait for it to settle.
    if (isSubmitting) {
      return;
    }

    if (hasAnyAnswer) {
      setIsDiscardConfirmOpen(true);
      return;
    }

    onClose();
  };

  // Tab-cycling focus trap + Escape close (audit 3/10). Escape rides the same
  // guarded close request as the X button, so a mid-fill Escape opens the
  // discard confirmation instead of silently dropping 40+ answers. The
  // nested MUI discard dialog traps its own focus — step aside while open.
  const handleOverlayKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isDiscardConfirmOpen) {
      return;
    }

    if (event.key === 'Escape') {
      event.stopPropagation();
      handleCloseRequest();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusables = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    );

    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const isInside = active instanceof Node && dialog.contains(active);

    if (event.shiftKey) {
      if (!isInside || active === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (!isInside || active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleComplete = () => {
    if (!isBatteryReady || isSubmitting) {
      return;
    }

    // The optional sections appear in the payload only when they were rendered
    // (doc §3.3: sam/gems keys ride the same battery record when enabled).
    onComplete({
      stai: answersBySection.stai ?? {},
      panas: answersBySection.panas ?? {},
      ...(answersBySection.sam ? { sam: answersBySection.sam } : {}),
      ...(answersBySection.gems ? { gems: answersBySection.gems } : {}),
    });
  };

  // Dev auto-fill rides the SAME handleAnswer path as manual clicks: one flat
  // item list (question id + legal range) plus an id -> section lookup.
  const fillItems = useMemo<ScaleFillItem[]>(
    () => definition.sections.flatMap((section) => section.questions.map((question) => ({
      id: question.id,
      minValue: section.minValue,
      maxValue: section.maxValue ?? section.minValue + Math.max(0, section.anchorLabels.length - 1),
    }))),
    [definition],
  );
  const sectionKeyById = useMemo(
    () => new Map(
      definition.sections.flatMap((section) => section.questions.map((question) => [question.id, section.key] as const)),
    ),
    [definition],
  );
  const answeredIds = sectionStates.flatMap(({ answers }) =>
    Object.keys(answers).filter((id) => typeof answers[id] === 'number'));

  // Portal to <body>: same overlay-trapping rationale as MentalScaleDialog.
  return createPortal(
    <div
      className={`${styles.scaleOverlay} fixed inset-0 flex items-center justify-center p-22px`}
      role="presentation"
      onKeyDown={handleOverlayKeyDown}
    >
      <section
        className={`${styles.scaleDialog} w-full max-w-720px`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="instrument-scale-title"
        ref={dialogRefCallback}
        tabIndex={-1}
      >
        <div className={styles.scaleStickyBar}>
          <ScaleProgressBar answered={answeredCount} total={totalQuestions} />
          <IconButton
            className={styles.scaleCloseButton}
            aria-label={isSubmitting ? '正在保存量表，请稍候' : '关闭情绪状态量表'}
            size="small"
            disabled={isSubmitting}
            onClick={handleCloseRequest}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </div>

        <div className={styles.scaleHeading}>
          <p className={styles.scaleEyebrow}>心理量表</p>
          <h2 id="instrument-scale-title">{definition.title}</h2>
          <p>{definition.subtitle}</p>
        </div>

        <div className={sectionStyles.scaleBody}>
          {sectionStates.map(({ section, answers }) => (
            <section className={sectionStyles.scaleSection} key={section.key}>
              <div className={sectionStyles.scaleStickySectionHead}>
                <ScaleSectionHeader
                  title={section.title}
                  instruction={section.instruction}
                  answeredCount={sectionAnsweredCount(section, answers)}
                  totalCount={section.questions.length}
                />
              </div>

              <div className={sectionStyles.itemList}>
                {section.questions.map((question) => (
                  <ScaleItemRow badge={question.id} prompt={question.textZh} key={question.id}>
                    <ScaleAnchorGroup
                      layout={section.layout === 'bipolar' ? 'bipolar' : 'discrete'}
                      minValue={section.minValue}
                      maxValue={section.maxValue}
                      anchorLabels={section.anchorLabels}
                      lowLabel={question.lowLabel}
                      highLabel={question.highLabel}
                      value={answers[question.id]}
                      onSelect={(value) => handleAnswer(section.key, question.id, value)}
                      ariaLabel={question.textZh}
                    />
                  </ScaleItemRow>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className={styles.scaleFooter}>
          <DevAutoFillButton
            items={fillItems}
            answeredIds={answeredIds}
            onAnswer={(questionId, value) => {
              const sectionKey = sectionKeyById.get(questionId);
              if (sectionKey !== undefined) {
                handleAnswer(sectionKey, questionId, value);
              }
            }}
            onClear={() => setAnswersBySection({})}
          />
          <div className={styles.scaleFooterActions}>
            {/* A failed save surfaces HERE, above the still-filled answers:
                the owner keeps this dialog mounted on failure so the
                participant can resubmit instead of refilling 40+ items. */}
            {submitError ? (
              <span className={`${styles.scaleFooterHint} ${sectionStyles.submitError}`} role="alert">
                {submitError}
              </span>
            ) : (
              <span className={styles.scaleFooterHint}>
                {isBatteryReady ? '已完成，可以提交量表。' : `完成全部 ${sectionStates.length} 节的题目后才能提交。`}
              </span>
            )}
            <button
              type="button"
              className={styles.scalePrimaryButton}
              disabled={!isBatteryReady || isSubmitting}
              onClick={handleComplete}
            >
              {isSubmitting ? '正在保存量表…' : '提交量表'}
            </button>
          </div>
        </div>
      </section>

      {/* Portals to <body>, so nesting inside the overlay costs nothing. */}
      <Dialog
        open={isDiscardConfirmOpen}
        onClose={() => setIsDiscardConfirmOpen(false)}
        aria-labelledby="instrument-scale-discard-title"
      >
        <DialogTitle id="instrument-scale-discard-title">放弃本次作答?</DialogTitle>
        <DialogContent>
          <DialogContentText>关闭后已填写的答案不会被保存。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsDiscardConfirmOpen(false)}>继续作答</Button>
          <Button color="error" onClick={onClose}>放弃并关闭</Button>
        </DialogActions>
      </Dialog>
    </div>,
    document.body,
  );
}
