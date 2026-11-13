import Modal from '@mui/material/Modal';
import type { EffectEvaluationFlowState } from './effectEvaluationFlow';
import { ConditionCountdown } from './EffectConditionCountdown';
import { useTestSkip } from './useTestSkip';
import styles from './EffectRestFixation.module.css';

export function EffectRestFixation({
  state,
  onElapsed,
  onSkip,
  onExit,
}: {
  state: EffectEvaluationFlowState;
  onElapsed: () => void;
  onSkip: () => void;
  onExit: () => void;
}) {
  useTestSkip(state.runMode === 'rehearsal', onSkip);
  return (
    <Modal
      open
      hideBackdrop
      onClose={(_, reason) => {
        if (reason === 'escapeKeyDown') onExit();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="静息，请注视中央十字"
        className={styles.screen}
        tabIndex={-1}
      >
        <span className={styles.cross} aria-hidden="true" />
        <ConditionCountdown state={state} windowNoun="静息" onElapsed={onElapsed} silent />
      </div>
    </Modal>
  );
}
