import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Collapse from '@mui/material/Collapse';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { EFFECT_FLOW_STEP_COUNT, type EffectFlowStep } from './effectEvaluationFlow';
import type { EffectPipelineNode } from './effectPipeline';
import { EffectDoneBand, EffectTimeline, type EffectStationClick } from './EffectTimeline';
import styles from './EffectEvaluation.module.css';

/**
 * Collapsible progress disclosure (round-7 gan-loop-effect): the six-station
 * timeline no longer squats above the stage on every step. Default state is
 * ONE light pill row — mini progress dots + `步骤 X / 6 · 当前站` + an
 * expand toggle — and the full timeline/done-band panel lives behind it.
 *
 * Behavior contract:
 * - Collapsed by default; the operator opens it on demand (click; the toggle
 *   is a real 40px-touchable button with aria-expanded/aria-controls).
 * - Step-change announcement (方案B): on every step transition the panel
 *   blooms so the operator can re-orient, then self-collapses after ~2s —
 *   unless the operator explicitly opened it (pinned) or a scale dialog is
 *   open.
 * - Scale dialog takes over the viewport (its own sticky header + focus
 *   trap): the disclosure force-collapses and drops any pin, so the flow
 *   indicator never competes with the instrument.
 *
 * Performance contract: memoized like EffectTimeline/EffectDoneBand — the
 * props (stable node arrays + stable callbacks + step/dialog booleans) only
 * change on real flow-state changes, and the announce timer's own
 * setIsOpen(false) re-renders just this subtree. The one-shot setTimeout is
 * cleaned up on unmount/step change; nothing here polls the wall clock.
 */

/** How long the step-change announcement stays open before folding. */
const ANNOUNCE_MS = 2200;

type EffectProgressDisclosureProps = {
  nodes: EffectPipelineNode[];
  /** Already-filtered done nodes (memoized by the page). */
  doneNodes: EffectPipelineNode[];
  /** done → review popover, current → stage scroll; decided by the page. */
  onStationClick: EffectStationClick;
  /** Done-band chips open the same review popover. */
  onChipClick: EffectStationClick;
  /** Page-owned scale-dialog open state: true forces the panel closed. */
  scaleDialogOpen: boolean;
  /** Current flow step (drives the summary line + the announce effect). */
  step: EffectFlowStep;
};

export const EffectProgressDisclosure = memo(function EffectProgressDisclosure({
  nodes,
  doneNodes,
  onStationClick,
  onChipClick,
  scaleDialogOpen,
  step,
}: EffectProgressDisclosureProps) {
  const [isOpen, setIsOpen] = useState(false);
  // True while the operator — not the announce effect — owns the open state:
  // a manual open survives step changes until manually closed.
  const isPinnedRef = useRef(false);
  const announceTimerRef = useRef<number | null>(null);
  const hasRenderedStepRef = useRef(false);
  // Ref mirrors let the step-announce effect read the latest dialog/pin facts
  // without re-firing on their changes (only step transitions announce).
  const scaleDialogOpenRef = useRef(scaleDialogOpen);
  scaleDialogOpenRef.current = scaleDialogOpen;

  const clearAnnounceTimer = useCallback(() => {
    if (announceTimerRef.current !== null) {
      window.clearTimeout(announceTimerRef.current);
      announceTimerRef.current = null;
    }
  }, []);

  // The instrument dialog must fully own the viewport: collapse + drop the
  // pin, so closing the dialog leaves the page quiet (the operator can
  // always reopen the panel).
  useEffect(() => {
    if (scaleDialogOpen) {
      clearAnnounceTimer();
      isPinnedRef.current = false;
      setIsOpen(false);
    }
  }, [scaleDialogOpen, clearAnnounceTimer]);

  // Step-change announcement: bloom on every transition, fold after ~2s.
  // The first render (including a resumed run) keeps the natural position.
  useEffect(() => {
    if (!hasRenderedStepRef.current) {
      hasRenderedStepRef.current = true;
      return;
    }

    if (scaleDialogOpenRef.current || isPinnedRef.current) {
      return;
    }

    setIsOpen(true);
    announceTimerRef.current = window.setTimeout(() => {
      announceTimerRef.current = null;
      setIsOpen(false);
    }, ANNOUNCE_MS);
    return clearAnnounceTimer;
  }, [step, clearAnnounceTimer]);

  useEffect(() => clearAnnounceTimer, [clearAnnounceTimer]);

  // Manual toggle: opening pins the panel open, closing unpins it.
  const handleToggle = useCallback(() => {
    clearAnnounceTimer();
    setIsOpen((open) => {
      isPinnedRef.current = !open;
      return !open;
    });
  }, [clearAnnounceTimer]);

  const currentNode = nodes.find((node) => node.status === 'current') ?? nodes[step];

  // One-shot media query (no listener/state): 0ms under reduced motion so the
  // reveal is an instant cut, 220ms (--dur-med) otherwise. Computed in render,
  // never at module scope, so node-env imports never touch `window`.
  const collapseTimeout = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;

  return (
    <section className={styles.progress} aria-label="评价流程进度">
      <button
        type="button"
        className={styles.progressToggle}
        aria-expanded={isOpen}
        aria-controls="effect-progress-panel"
        title={isOpen ? '收起流程图' : '展开流程图'}
        onClick={handleToggle}
      >
        <span className={styles.progressDots} aria-hidden="true">
          {nodes.map((node) => (
            <span
              key={node.step}
              className={
                node.status === 'done'
                  ? styles.progressDotDone
                  : node.status === 'current'
                    ? styles.progressDotCurrent
                    : styles.progressDotPending
              }
            />
          ))}
        </span>
        <span className={styles.progressSummary}>
          步骤 {step + 1} / {EFFECT_FLOW_STEP_COUNT} · {currentNode.shortLabel}
        </span>
        <ExpandMoreRoundedIcon
          className={`${styles.progressChevron}${isOpen ? ` ${styles.progressChevronOpen}` : ''}`}
          aria-hidden="true"
        />
        <span className={styles.progressToggleHint}>{isOpen ? '收起' : '展开'}</span>
      </button>
      <Collapse in={isOpen} timeout={collapseTimeout} unmountOnExit>
        <div id="effect-progress-panel" className={styles.progressPanel}>
          <EffectTimeline nodes={nodes} onStationClick={onStationClick} />
          <EffectDoneBand doneNodes={doneNodes} onChipClick={onChipClick} />
        </div>
      </Collapse>
    </section>
  );
});
