import { memo, type ReactNode } from 'react';
import {
  labelForCondition,
  type EffectEvaluationFlowState,
  type EffectFlowStep,
} from './effectEvaluationFlow';
import type {
  EffectPipelineNode,
  EffectPipelineNodeStatus,
} from './effectPipeline';
import styles from './EffectEvaluation.module.css';

/**
 * Rendering shell for one pipeline node card (see `effectPipeline.ts` for
 * the pure status model). The card is memoized: while the condition window's
 * wall-clock tick re-renders the page every 500ms, done/pending cards bail
 * out on stable props — the ticking content only enters through `children`
 * of the current node's card, and the countdown digits live in their own
 * memo child inside that card (ConditionStepPanel's ConditionCountdown).
 */

const STATUS_LABEL: Record<EffectPipelineNodeStatus, string> = {
  done: '已完成',
  current: '进行中',
  pending: '未解锁',
};

const STATUS_BADGE_CLASS: Record<EffectPipelineNodeStatus, string> = {
  done: styles.pipelineBadgeDone,
  current: styles.pipelineBadgeCurrent,
  pending: styles.pipelineBadgePending,
};

function PipelineStatusBadge({ status }: { status: EffectPipelineNodeStatus }) {
  return (
    <span className={`${styles.pipelineBadge} ${STATUS_BADGE_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

type EffectPipelineCardProps = {
  node: EffectPipelineNode;
  isExpanded: boolean;
  onToggle: (step: EffectFlowStep) => void;
  /**
   * Current node: the interactive step panel. Done node (expanded only):
   * the detail block. Must stay `undefined` for collapsed/pending nodes so
   * the memo comparison bails them out of wall-clock re-renders.
   */
  children?: ReactNode;
};

export const EffectPipelineCard = memo(function EffectPipelineCard({
  node,
  isExpanded,
  onToggle,
  children,
}: EffectPipelineCardProps) {
  const isDone = node.status === 'done';
  const isCurrent = node.status === 'current';
  const isPending = node.status === 'pending';

  const cardClass = `${styles.pipelineCard} ${
    isCurrent
      ? styles.pipelineCardCurrent
      : isDone
        ? styles.pipelineCardDone
        : styles.pipelineCardPending
  }`;

  const head = (
    <>
      <span className={styles.pipelineIndex} aria-hidden="true">{node.step}</span>
      <span className={styles.pipelineTitle}>{node.title}</span>
      {isDone && node.skipped ? (
        <span className={styles.pipelineSkippedChip}>已跳过剩余时长</span>
      ) : null}
      {isDone ? (
        <span className={styles.pipelineSummary}>{node.summary}</span>
      ) : null}
      {isPending ? (
        <span className={styles.pipelinePendingHint}>完成前序节点后解锁</span>
      ) : null}
      <PipelineStatusBadge status={node.status} />
      {isDone ? (
        <span
          className={`${styles.expandIcon} ${isExpanded ? styles.expandIconOpen : ''}`}
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  return (
    <section className={cardClass} aria-label={node.title}>
      {/* Only completed rows are expandable; current/pending heads stay static. */}
      {isDone ? (
        <button
          type="button"
          className={styles.pipelineHead}
          aria-expanded={isExpanded}
          onClick={() => onToggle(node.step)}
        >
          {head}
        </button>
      ) : (
        <div className={styles.pipelineHead} aria-disabled={isPending}>
          {head}
        </div>
      )}

      {isCurrent && children ? (
        <div className={styles.pipelineBody}>{children}</div>
      ) : null}
      {isDone && isExpanded && children ? (
        <div className={styles.pipelineDetails}>{children}</div>
      ) : null}
    </section>
  );
});

type PipelineDoneDetailsProps = {
  node: EffectPipelineNode;
  state: EffectEvaluationFlowState;
  emotionLabel: string;
  methodLabel: string;
  /** Skip warning copy (null while unskipped); surfaces on the condition row. */
  skippedCopy: string | null;
};

/** Expanded detail of a completed node: config/record chips taken straight
 *  from the flow state so the collapsed run stays auditable on screen. */
export function PipelineDoneDetails({
  node,
  state,
  emotionLabel,
  methodLabel,
  skippedCopy,
}: PipelineDoneDetailsProps) {
  const subjectId = state.subjectId.trim();

  return (
    <>
      <div className={styles.configSummary}>
        {node.step === 0 || node.step === 1 ? (
          <>
            <span className={styles.configChip}>被试 {subjectId || '未填写'}</span>
            <span className={styles.configChip}>目标情绪 {emotionLabel}</span>
            <span className={styles.configChip}>{methodLabel}</span>
            <span className={styles.configChip}>{labelForCondition(state.condition)}</span>
            <span className={styles.configChip}>时长 {state.durationMinutes} 分钟</span>
          </>
        ) : null}
        {node.step === 2 && state.baselineRecordId ? (
          <span className={styles.configChip} title={state.baselineRecordId}>
            诱发后量表记录 {`${state.baselineRecordId.slice(0, 8)}…`}
          </span>
        ) : null}
        {node.step === 3 ? (
          <>
            <span className={styles.configChip}>时长 {state.durationMinutes} 分钟</span>
            {state.eegSessionId ? (
              <span className={styles.configChip} title={state.eegSessionId}>
                EEG 会话 {`${state.eegSessionId.slice(0, 8)}…`}
              </span>
            ) : null}
          </>
        ) : null}
        {node.step === 4 && state.postRecordId ? (
          <span className={styles.configChip} title={state.postRecordId}>
            条件后量表记录 {`${state.postRecordId.slice(0, 8)}…`}
          </span>
        ) : null}
      </div>
      {node.step === 3 && skippedCopy ? (
        <p className={styles.noteCallout} role="note">{skippedCopy}</p>
      ) : null}
    </>
  );
}
