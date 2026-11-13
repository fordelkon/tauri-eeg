import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { useState } from 'react';
import { samDimensions, scoreSam, type SamScore } from './instruments/sam';
import type { ScalePhase } from './scaleRecordsApi';
import { clearBriefDraft, readBriefDraft, writeBriefDraft } from './briefRatingDraft';
import ScaleProgressBar from './scaleUi/ScaleProgressBar';
import styles from './BriefRatingDialog.module.css';

type Props = {
  runId: string;
  phase: ScalePhase;
  isSubmitting: boolean;
  submitError: string | null;
  onClose: () => void;
  onComplete: (answers: SamScore) => Promise<boolean>;
};

const names = { valence: '愉悦度', arousal: '唤醒度', dominance: '控制感' };
const values = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export default function BriefRatingDialog({
  runId,
  phase,
  isSubmitting,
  submitError,
  onClose,
  onComplete,
}: Props) {
  const [answers, setAnswers] = useState(() => readBriefDraft(window.sessionStorage, runId, phase));
  const count = Object.keys(answers).length;

  async function submit() {
    if (count !== samDimensions.length || isSubmitting) return;
    if (await onComplete(scoreSam(answers))) clearBriefDraft(window.sessionStorage, runId, phase);
  }

  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      aria-labelledby="vad-title"
      aria-describedby="vad-instruction"
      slotProps={{ paper: { className: styles.paper } }}
      onClose={isSubmitting ? undefined : onClose}
    >
      <header className={styles.heading}>
        <p className={styles.phase}>{phase === 'baseline' ? '前测' : '后测'}</p>
        <DialogTitle className={styles.title} id="vad-title">
          此刻感受
        </DialogTitle>
        <p id="vad-instruction" className={styles.instruction}>
          请按此刻的感受，每行选一个数字。
        </p>
      </header>
      <DialogContent className={styles.content}>
        {samDimensions.map(({ id, lowLabel, highLabel }) => (
          <fieldset key={id} className={styles.row} disabled={isSubmitting}>
            <legend>{names[id]}</legend>
            <div className={styles.choices}>
              {values.map((n) => (
                <label key={n} className={styles.choice}>
                  <input
                    type="radio"
                    name={id}
                    value={n}
                    aria-label={`${names[id]} ${n}`}
                    aria-describedby={`poles-${id}`}
                    checked={answers[id] === n}
                    onChange={() => {
                      const next = { ...answers, [id]: n };
                      setAnswers(next);
                      writeBriefDraft(window.sessionStorage, runId, phase, next);
                    }}
                  />
                  <span>{n}</span>
                </label>
              ))}
            </div>
            <div className={styles.poles} id={`poles-${id}`}>
              <span>1 · {lowLabel}</span>
              <span>9 · {highLabel}</span>
            </div>
          </fieldset>
        ))}
        {submitError && <Alert severity="error">{submitError}</Alert>}
      </DialogContent>
      <DialogActions className={styles.actions}>
        <div className={styles.progress} role="status">
          <ScaleProgressBar
            answered={count}
            total={samDimensions.length}
            label={`${count} / ${samDimensions.length} 已填`}
          />
        </div>
        <Button onClick={onClose} disabled={isSubmitting}>
          返回
        </Button>
        <Button
          variant="contained"
          disabled={count !== 3 || isSubmitting}
          onClick={() => void submit()}
        >
          {isSubmitting ? '正在保存…' : '提交评分'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
