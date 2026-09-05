import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton } from '@mui/material';
import { useMemo, useState } from 'react';
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
 * answered. Rendering is visual only — scoring, persistence and the submit
 * gate are untouched (battery module + onComplete contract).
 */
export default function InstrumentScaleDialog({
  definition,
  onComplete,
  onClose,
}: InstrumentScaleDialogProps) {
  const [answersBySection, setAnswersBySection] = useState<
    Partial<Record<BatterySectionKey, InstrumentAnswers>>
  >({});
  // Closing with answers already filled in asks for confirmation first; 40+
  // items are too much work to lose to one misclick.
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);

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
    if (hasAnyAnswer) {
      setIsDiscardConfirmOpen(true);
      return;
    }

    onClose();
  };

  const handleComplete = () => {
    if (!isBatteryReady) {
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
    >
      <section
        className={`${styles.scaleDialog} w-full max-w-720px`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="instrument-scale-title"
      >
        <div className={styles.scaleStickyBar}>
          <ScaleProgressBar answered={answeredCount} total={totalQuestions} />
          <IconButton
            className={styles.scaleCloseButton}
            aria-label="关闭情绪状态量表"
            size="small"
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
            <span className={styles.scaleFooterHint}>
              {isBatteryReady ? '已完成，可以提交量表。' : `完成全部 ${sectionStates.length} 节的题目后才能提交。`}
            </span>
            <button
              type="button"
              className={styles.scalePrimaryButton}
              disabled={!isBatteryReady}
              onClick={handleComplete}
            >
              提交量表
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
