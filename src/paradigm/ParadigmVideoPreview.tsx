import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toPlayableVideoUrl } from '../video/videoRegulationCatalog';
import type { ParadigmVideoEntry } from './types';
import styles from './ParadigmSession.module.css';

type Props = {
  entry: ParadigmVideoEntry;
  onClose: () => void;
};

/** Paradigm-style fullscreen preview: black stage, centered video. Portal to
 * document.body — the setup panel lives inside the Home shell's stacking
 * context (.content z1), so a plain fixed overlay would paint BELOW the
 * floating nav rail (z3) and the agent panel column. Every other fullscreen
 * surface in the app (ParadigmRunner, scale dialogs, fullscreen regulation
 * stages) portals for the same reason. */
export default function ParadigmVideoPreview({ entry, onClose }: Props) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className={styles.previewOverlay} role="dialog" aria-label="素材预览" onClick={onClose}>
      <video
        className={styles.previewVideo}
        src={toPlayableVideoUrl(entry.absolutePath, convertFileSrc)}
        controls={false}
        disablePictureInPicture
        onContextMenu={(event) => event.preventDefault()}
        onEnded={onClose}
        autoPlay
        playsInline
        ref={(node) => {
          if (node) {
            node.volume = 1;
          }
        }}
      />
    </div>,
    document.body,
  );
}
