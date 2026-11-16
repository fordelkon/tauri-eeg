import { DEVELOPMENT_BUILD } from '../experiment/buildMode';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { useState } from 'react';
import {
  DEQ_SCALE_ID,
  deqAnchors,
  deqItems,
  hasCompleteDeqRatings,
  isDeqRating,
  type DeqAnswers,
} from './instruments/deq';
import { createRatingDraft } from './ratingDraft';
import type { ScalePhase } from './scaleRecordsApi';
import ScaleProgressBar from './scaleUi/ScaleProgressBar';
import DevAutoFillButton from './scaleUi/DevAutoFillButton';
import styles from './DeqRatingDialog.module.css';

type Props = {
  rehearsal: boolean;
  runId: string;
  phase: ScalePhase;
  isSubmitting: boolean;
  submitError: string | null;
  onClose: () => void;
  onComplete: (answers: DeqAnswers) => Promise<boolean>;
};

const phaseLabels = { pre_induction: '诱发前', baseline: '诱发后', post: '条件结束后' };
const draft = createRatingDraft(
  `effect-evaluation.${DEQ_SCALE_ID}.draft`,
  deqItems.map(({ id }) => id),
  isDeqRating,
);

export default function DeqRatingDialog(props: Props) {
  return <RatingForm key={JSON.stringify([props.runId, props.phase])} {...props} />;
}

function RatingForm({
  runId,
  phase,
  rehearsal,
  isSubmitting,
  submitError,
  onClose,
  onComplete,
}: Props) {
  const [ratings, setRatings] = useState(() => draft.read(window.sessionStorage, runId, phase));
  const count = Object.keys(ratings).length;

  async function submit() {
    if (isSubmitting || !hasCompleteDeqRatings(ratings)) return;
    if (await onComplete({ deq: ratings })) draft.clear(window.sessionStorage, runId, phase);
  }

  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      aria-labelledby="deq-title"
      aria-describedby="deq-instruction"
      slotProps={{ paper: { className: styles.paper } }}
      onClose={isSubmitting ? undefined : onClose}
    >
      <header className={styles.heading}>
        <p className={styles.phase}>{phaseLabels[phase]}</p>
        <DialogTitle className={styles.title} id="deq-title">
          此刻的情绪感受
        </DialogTitle>
        <p className={styles.instruction} id="deq-instruction">
          请为每种感受选择最符合你此刻体验的强度。几种感受可以同时出现，也可以都选“完全没有”。
        </p>
      </header>
      <DialogContent className={styles.content}>
        {deqItems.map(({ id, label }) => (
          <fieldset key={id} className={styles.row} disabled={isSubmitting}>
            <legend>{label}</legend>
            <div className={styles.choices}>
              {deqAnchors.map((anchor, index) => {
                const value = index + 1;
                return (
                  <label key={value} className={styles.choice}>
                    <input
                      type="radio"
                      name={id}
                      value={value}
                      aria-label={`${label} ${value} ${anchor}`}
                      checked={ratings[id] === value}
                      onChange={() => {
                        const next = { ...ratings, [id]: value };
                        setRatings(next);
                        draft.write(window.sessionStorage, runId, phase, next);
                      }}
                    />
                    <span>
                      {value}
                      <small>{anchor}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </DialogContent>
      {submitError && <Alert severity="error">{submitError}</Alert>}
      <DialogActions className={styles.actions}>
        {DEVELOPMENT_BUILD && rehearsal && !isSubmitting && (
          <DevAutoFillButton
            items={deqItems.map(({ id }) => ({ id, minValue: 1, maxValue: deqAnchors.length }))}
            answeredIds={Object.keys(ratings)}
            onFill={(fill) => {
              const next = { ...ratings, ...fill };
              setRatings(next);
              draft.write(window.sessionStorage, runId, phase, next);
            }}
          />
        )}
        <div className={styles.progress} role="status">
          <ScaleProgressBar
            answered={count}
            total={deqItems.length}
            label={`${count} / ${deqItems.length} 已填`}
          />
        </div>
        <Button onClick={onClose} disabled={isSubmitting}>
          返回
        </Button>
        <Button
          variant="contained"
          disabled={count !== deqItems.length || isSubmitting}
          onClick={() => void submit()}
        >
          {isSubmitting ? '正在保存…' : '提交评分'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
