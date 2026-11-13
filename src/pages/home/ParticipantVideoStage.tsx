import Modal from '@mui/material/Modal';
import type { ReactNode } from 'react';
import styles from './EffectEvaluation.module.css';

/** The modal traps focus and hides the experiment controls behind the stimulus. */
export function ParticipantVideoStage({
  playing,
  onExit,
  children,
}: {
  playing: boolean;
  onExit: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      open
      hideBackdrop
      onClose={(_, reason) => {
        if (reason === 'escapeKeyDown') onExit();
      }}
    >
      <section
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="视频呈现"
        data-playing={playing || undefined}
        className={styles.fullscreenRegulationStage}
      >
        {children}
      </section>
    </Modal>
  );
}
