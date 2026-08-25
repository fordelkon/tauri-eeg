import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton } from '@mui/material';
import { useState } from 'react';
import {
  isMentalScaleComplete,
  mentalScaleAnswerOptions,
  type MentalScaleAnswers,
  type MentalScaleAnswerValue,
  type MentalScaleDefinition,
} from './mentalScaleGate';
import styles from './MentalScaleDialog.module.css';

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

  return (
    <div
      className={`${styles.scaleOverlay} fixed inset-0 flex items-center justify-center p-22px`}
      role="presentation"
    >
      <section
        className={`${styles.scaleDialog} grid gap-20px overflow-y-auto w-full max-w-720px`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mental-scale-title"
      >
        <div className={`${styles.scaleHeader} flex items-start justify-between gap-18px`}>
          <div>
            <p className={styles.scaleEyebrow}>心理量表</p>
            <h2 id="mental-scale-title">{scale.title}</h2>
            <p>{scale.subtitle}</p>
          </div>
          <IconButton
            className={styles.scaleCloseButton}
            aria-label="关闭心理量表"
            size="small"
            onClick={handleCloseRequest}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </div>

        <div className="grid gap-14px">
          {scale.questions.map((question, questionIndex) => (
            <fieldset className={`${styles.scaleQuestion} grid gap-14px m-0 p-16px`} key={question.id}>
              <legend className="flex items-center gap-10px p-0">
                <span className="inline-flex flex-none items-center justify-center h-24px w-24px">{questionIndex + 1}</span>
                {question.prompt}
              </legend>
              <div className={`${styles.scaleOptions} grid gap-8px`}>
                {mentalScaleAnswerOptions.map((option) => {
                  const isSelected = scaleAnswers[question.id] === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`${isSelected ? styles.isScaleOptionSelected : ''} grid items-center gap-4px min-h-62px px-8px py-9px`}
                      aria-pressed={isSelected}
                      onClick={() => handleAnswer(question.id, option.value)}
                    >
                      <strong>{option.value}</strong>
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <div className={`${styles.scaleFooter} flex items-center justify-between gap-14px`}>
          <span className={styles.scaleFooterHint}>
            {isScaleReady ? '已完成，可以进入调控页面。' : '完成全部题目后继续。'}
          </span>
          <div className="flex flex-none items-center gap-10px">
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
    </div>
  );
}
