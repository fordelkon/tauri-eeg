import Popover from '@mui/material/Popover';
import {
  EFFECT_FLOW_STEPS,
  type EffectEvaluationFlowState,
  labelForCondition,
} from './effectEvaluationFlow';
import type { EffectReviewTarget } from './EffectTimeline';
import styles from './EffectEvaluation.module.css';

/**
 * Read-only review overlay for a completed node: anchored to the timeline
 * station / done-band chip that opened it, it surfaces only data the flow
 * state already holds — record ids, the EEG session id, the skip marker,
 * and the run configuration. Nothing here mutates the flow; closing the
 * popover just dismisses it.
 *
 * The SAM manipulation check is a fact of the baseline battery (built with
 * `includeSam: true`, node 2), and GEMS-9 rides the post record of music
 * runs (node 4) — both are annotated without re-reading the stored record
 * (the backend exposes no record-fetch command, and none was added).
 */

type EffectReviewPopoverProps = {
  /** null = closed. */
  review: EffectReviewTarget | null;
  state: EffectEvaluationFlowState;
  emotionLabel: string;
  methodLabel: string;
  /** Skip warning copy (null while unskipped); shown on the condition node. */
  skippedCopy: string | null;
  onClose: () => void;
};

export function EffectReviewPopover({
  review,
  state,
  emotionLabel,
  methodLabel,
  skippedCopy,
  onClose,
}: EffectReviewPopoverProps) {
  const step = review?.step ?? 0;
  // Nouns per condition (R6): the timeline station renders 调控/静息, so the
  // review title ties that word back to the formal step name 条件执行, and
  // the method chip only appears on regulation runs (a natural-recovery leg
  // has no regulation media to report).
  const isNaturalRecovery = state.condition === 'natural_recovery';
  const stepTitle = step === 3
    ? `条件执行（${isNaturalRecovery ? '静息' : '调控'}）`
    : EFFECT_FLOW_STEPS[step];

  return (
    <Popover
      open={review !== null}
      anchorEl={review?.anchorEl ?? null}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      slotProps={{ paper: { className: styles.reviewPaper } }}
    >
      <div className={styles.reviewCard} aria-label="已完成节点回顾">
        <div className={styles.reviewTitle}>
          {stepTitle} · 已完成回顾
        </div>

        <div className={styles.configSummary}>
          {step <= 1 ? (
            <>
              <span className={styles.configChip}>被试 {state.subjectId.trim() || '未填写'}</span>
              <span className={styles.configChip}>目标情绪 {emotionLabel}</span>
              {!isNaturalRecovery ? (
                <span className={styles.configChip}>{methodLabel}</span>
              ) : null}
              <span className={styles.configChip}>{labelForCondition(state.condition)}</span>
              <span className={styles.configChip}>时长 {state.durationMinutes} 分钟</span>
            </>
          ) : null}
          {step === 2 && state.baselineRecordId ? (
            <>
              <span className={styles.configChip} title={state.baselineRecordId}>
                诱发后量表记录 {`${state.baselineRecordId.slice(0, 8)}…`}
              </span>
              {/* The baseline battery prepends the SAM manipulation check
                  (doc scale-instruments.md §3.3) — stated as a record fact. */}
              <span className={styles.configChip}>含 SAM 操纵检验</span>
            </>
          ) : null}
          {step === 3 ? (
            <>
              {/* What the window actually did — the fact the review exists
                  to answer: which condition ran (and on which media). */}
              <span className={styles.configChip}>{labelForCondition(state.condition)}</span>
              {!isNaturalRecovery ? (
                <span className={styles.configChip}>{methodLabel}</span>
              ) : null}
              <span className={styles.configChip}>时长 {state.durationMinutes} 分钟</span>
              {state.eegSessionId ? (
                <span className={styles.configChip} title={state.eegSessionId}>
                  EEG 会话 {`${state.eegSessionId.slice(0, 8)}…`}
                </span>
              ) : null}
              {state.regulationSkipped ? (
                <span className={styles.configChip}>已跳过剩余时长</span>
              ) : null}
            </>
          ) : null}
          {step === 4 && state.postRecordId ? (
            <>
              <span className={styles.configChip} title={state.postRecordId}>
                条件后量表记录 {`${state.postRecordId.slice(0, 8)}…`}
              </span>
              {state.method === 'music' ? (
                <span className={styles.configChip}>含 GEMS-9 音乐情绪量表</span>
              ) : null}
            </>
          ) : null}
        </div>

        {step === 3 && skippedCopy ? (
          <p className={styles.noteCallout} role="note">{skippedCopy}</p>
        ) : null}

        <p className={styles.reviewFootnote}>只读回顾 · 点击其他区域关闭</p>
      </div>
    </Popover>
  );
}
