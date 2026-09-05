import { memo } from 'react';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import type { EffectFlowStep } from './effectEvaluationFlow';
import type { EffectPipelineNode } from './effectPipeline';
import styles from './EffectEvaluation.module.css';

/**
 * The page's visual protagonist: a horizontal six-station timeline
 * (配置 → 诱发 → 量表 → 调控/静息 → 复测 → 结果) plus the compression band
 * that keeps finished nodes out of the main stage.
 *
 * Station semantics:
 * - done   → filled green disc with a check; clickable (opens the read-only
 *            review popover for that node);
 * - current→ hollow brand ring with a micro pulse; clickable (scrolls the
 *            main stage into view);
 * - pending→ gray disc, disabled.
 *
 * Performance contract: the wall-clock tick never reaches this subtree — the
 * condition window's 500ms poll lives in the self-contained countdown leaf,
 * and the page re-renders only on real flow-state changes. Both components
 * are memoized and their props (node array derived from the specific state
 * fields the pipeline reads + stable callbacks) keep their identity across
 * unrelated dispatches (e.g. the EEG badge flip), so those bail out too.
 */

/** Signature shared by the station and band click handlers. */
export type EffectStationClick = (step: EffectFlowStep, anchorEl: HTMLElement) => void;

/** Anchor + node of an open review overlay (consumed by the popover). */
export type EffectReviewTarget = {
  step: EffectFlowStep;
  anchorEl: HTMLElement;
};

type EffectTimelineProps = {
  nodes: EffectPipelineNode[];
  /** done → review popover, current → stage scroll; decided by the page. */
  onStationClick: EffectStationClick;
};

export const EffectTimeline = memo(function EffectTimeline({
  nodes,
  onStationClick,
}: EffectTimelineProps) {
  return (
    <ol className={styles.timeline} aria-label="评价流程时间线">
      {nodes.map((node, index) => {
        const isDone = node.status === 'done';
        const isCurrent = node.status === 'current';
        // The segment left of this station turns green once the previous
        // station finished (the walk has passed through it).
        const segmentDone = index > 0 && nodes[index - 1].status === 'done';
        const clickable = isDone || isCurrent;
        const dotClass = isDone
          ? styles.stationDotDone
          : isCurrent ? styles.stationDotCurrent : styles.stationDotPending;
        const labelClass = node.status === 'pending'
          ? styles.stationLabelPending
          : styles.stationLabel;

        return (
          <li
            key={node.step}
            className={`${styles.timelineItem}${segmentDone ? ` ${styles.segmentDone}` : ''}`}
          >
            <button
              type="button"
              className={`${styles.station}${clickable ? ` ${styles.stationClickable}` : ''}`}
              disabled={!clickable}
              aria-current={isCurrent ? 'step' : undefined}
              title={isDone ? '查看已保存的信息' : isCurrent ? '定位到当前任务' : undefined}
              onClick={(event) => onStationClick(node.step, event.currentTarget)}
            >
              <span className={`${styles.stationDot} ${dotClass}`} aria-hidden="true">
                {isDone ? <CheckRoundedIcon className={styles.stationCheck} /> : node.step + 1}
              </span>
              <span className={labelClass}>{node.shortLabel}</span>
              <span className={styles.stationStatus}>{node.statusText}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
});

type EffectDoneBandProps = {
  /** Already-filtered done nodes; the page memoizes the filter result. */
  doneNodes: EffectPipelineNode[];
  /** Every chip opens the same read-only review popover as the stations. */
  onChipClick: EffectStationClick;
};

/**
 * Compression band under the timeline: finished nodes shrink into clickable
 * chips so the main stage never has to render them again. Chips carry the
 * skip marker inline (已跳过) so a flagged run stays visible at a glance.
 */
export const EffectDoneBand = memo(function EffectDoneBand({
  doneNodes,
  onChipClick,
}: EffectDoneBandProps) {
  if (doneNodes.length === 0) {
    return null;
  }

  return (
    <div className={styles.doneBand} aria-label="已完成节点">
      <span className={styles.doneBandLabel}>已完成</span>
      {doneNodes.map((node) => (
        <button
          key={node.step}
          type="button"
          className={styles.doneChip}
          title={`回顾「${node.title}」已保存的信息`}
          onClick={(event) => onChipClick(node.step, event.currentTarget)}
        >
          <CheckRoundedIcon className={styles.doneChipCheck} aria-hidden="true" />
          {node.shortLabel}
          {node.skipped ? ' · 已跳过' : ''}
        </button>
      ))}
    </div>
  );
});
