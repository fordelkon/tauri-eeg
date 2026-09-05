import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton } from '@mui/material';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  isMentalScaleComplete,
  mentalScaleAnswerOptions,
  type MentalScaleAnswers,
  type MentalScaleAnswerValue,
  type MentalScaleDefinition,
} from './mentalScaleGate';
import ScaleAnchorGroup from './scaleUi/ScaleAnchorGroup';
import ScaleItemRow from './scaleUi/ScaleItemRow';
import ScaleProgressBar from './scaleUi/ScaleProgressBar';
import styles from './MentalScaleDialog.module.css';
import sectionStyles from './InstrumentScaleDialog.module.css';

type MentalScaleDialogProps = {
  onComplete: (answers: MentalScaleAnswers) => void;
  onClose: () => void;
  /** Present when skipping is allowed for this entry path (e.g. manual navigation). */
  onSkip?: () => void;
  scale: MentalScaleDefinition;
};

export default function MentalScaleDialog({ onComplete, onClose, onSkip, scale }: MentalScaleDialogProps) {
  const [scaleAnswers, setScaleAnswers] = useState<MentalScaleAnswers>({});
  // Closing with answers already filled in asks for confirmation first; the
  // answers live here, so the guard belongs next to them.
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  const hasAnyAnswer = Object.keys(scaleAnswers).length > 0;
  const isScaleReady = isMentalScaleComplete(scale, scaleAnswers);
  const answeredCount = scale.questions.filter(
    (question) => scaleAnswers[question.id] !== undefined,
  ).length;
  // Screening cutoff note (doc scale-instruments.md §2.1): a neutral,
  // explicitly non-diagnostic hint once the completed total reaches the
  // literature threshold; scales without a screening note never show it.
  const totalScore = Object.values(scaleAnswers).reduce<number>(
    (total, value) => total + (value ?? 0),
    0,
  );
  const screeningNote = scale.screening && isScaleReady && totalScore >= scale.screening.threshold
    ? scale.screening.message
    : null;

  const handleAnswer = (questionId: string, value: MentalScaleAnswerValue) => {
    setScaleAnswers((answers) => ({
      ...answers,
      [questionId]: value,
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
    if (!isScaleReady) {
      return;
    }

    onComplete(scaleAnswers);
  };

  // Portal to <body>: the overlay must not be trapped by an ancestor
  // stacking context or reparented by a retained transform (a fixed
  // overlay inside an animated panel lands mispositioned and UNDER
  // sticky chrome, e.g. the wizard's progress bar).
  return createPortal(
    <div
      className={`${styles.scaleOverlay} fixed inset-0 flex items-center justify-center p-22px`}
      role="presentation"
    >
      <section
        className={`${styles.scaleDialog} w-full max-w-720px`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mental-scale-title"
      >
        <div className={styles.scaleStickyBar}>
          <ScaleProgressBar answered={answeredCount} total={scale.questions.length} />
          <IconButton
            className={styles.scaleCloseButton}
            aria-label="关闭心理量表"
            size="small"
            onClick={handleCloseRequest}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </div>

        <div className={styles.scaleHeading}>
          <p className={styles.scaleEyebrow}>心理量表</p>
          <h2 id="mental-scale-title">{scale.title}</h2>
          <p>{scale.subtitle}</p>
        </div>

        <div className={sectionStyles.scaleBody}>
          <div className={sectionStyles.itemList}>
            {scale.questions.map((question, questionIndex) => (
              <ScaleItemRow badge={String(questionIndex + 1)} prompt={question.prompt} key={question.id}>
                <ScaleAnchorGroup
                  layout="discrete"
                  minValue={mentalScaleAnswerOptions[0].value}
                  anchorLabels={mentalScaleAnswerOptions.map((option) => option.label)}
                  value={scaleAnswers[question.id]}
                  onSelect={(value) => handleAnswer(question.id, value as MentalScaleAnswerValue)}
                  ariaLabel={question.prompt}
                />
              </ScaleItemRow>
            ))}
          </div>
        </div>

        <div className={styles.scaleFooter}>
          <div className={styles.scaleFooterNotes}>
            <span className={styles.scaleFooterHint}>
              {isScaleReady ? '已完成，可以进入调控页面。' : '完成全部题目后继续。'}
            </span>
            {screeningNote ? <span className={styles.scaleScreeningNote}>{screeningNote}</span> : null}
          </div>
          <div className={styles.scaleFooterActions}>
            {onSkip ? (
              <button
                type="button"
                className={styles.scaleSkipButton}
                onClick={onSkip}
              >
                跳过本次
              </button>
            ) : null}
            <button
              type="button"
              className={styles.scalePrimaryButton}
              disabled={!isScaleReady}
              onClick={handleComplete}
            >
              进入
            </button>
          </div>
        </div>
      </section>

      {/* Portals to <body>, so nesting inside the overlay costs nothing. */}
      <Dialog
        open={isDiscardConfirmOpen}
        onClose={() => setIsDiscardConfirmOpen(false)}
        aria-labelledby="mental-scale-discard-title"
      >
        <DialogTitle id="mental-scale-discard-title">放弃本次作答?</DialogTitle>
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
