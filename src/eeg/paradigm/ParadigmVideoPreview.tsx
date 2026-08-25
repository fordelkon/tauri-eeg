import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect } from 'react';
import { toPlayableVideoUrl } from '../../video/videoRegulationCatalog';
import { paradigmEmotionLabels } from './types';
import type { ParadigmEmotion, ParadigmVideoEntry } from './types';
import styles from './ParadigmSession.module.css';

type Props = {
  emotion: ParadigmEmotion;
  entry: ParadigmVideoEntry;
  onClose: () => void;
};

/** Paradigm-style fullscreen preview: black stage, centered video. */
export default function ParadigmVideoPreview({ emotion, entry, onClose }: Props) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className={styles.previewOverlay} role="dialog" aria-label="素材预览" onClick={onClose}>
      <div className={styles.previewTopBar} onClick={(event) => event.stopPropagation()}>
        <span className={styles.previewTitle}>
          {paradigmEmotionLabels[emotion]} · {entry.fileName}
        </span>
        <button type="button" className={styles.previewCloseButton} onClick={onClose}>
          关闭预览(ESC)
        </button>
      </div>
      <video
        className={styles.previewVideo}
        src={toPlayableVideoUrl(entry.absolutePath, convertFileSrc)}
        controls
        autoPlay
        playsInline
        ref={(node) => {
          if (node) {
            node.volume = 1;
          }
        }}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
