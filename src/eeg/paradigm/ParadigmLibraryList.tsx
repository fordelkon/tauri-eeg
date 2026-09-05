import { memo } from 'react';
import {
  PARADIGM_EMOTION_DISPLAY_ORDER,
  paradigmEmotionLabels,
} from './types';
import { libraryClassKeys } from './paradigmSessionKinds';
import type {
  ParadigmEmotion,
  ParadigmVideoEntry,
  ParadigmVideoLibrary,
} from './types';
import styles from './ParadigmSession.module.css';

type ParadigmLibraryListProps = {
  library: ParadigmVideoLibrary;
  selectedVideoIds: ReadonlySet<string>;
  onSelectPreview: (emotion: ParadigmEmotion, entry: ParadigmVideoEntry) => void;
};

/**
 * The full 素材清单: every entry of all five emotion classes as preview
 * buttons. Memoized so keystrokes in 被试 ID / 会话运行 ID — which re-render
 * the whole setup panel — do not rebuild hundreds of buttons; only a library
 * load or a queue-preview change (selection badges) re-renders the list.
 */
export const ParadigmLibraryList = memo(function ParadigmLibraryList({
  library,
  selectedVideoIds,
  onSelectPreview,
}: ParadigmLibraryListProps) {
  return (
    <details className={styles.videoListDetails}>
      <summary className={styles.videoListSummary}>素材清单(点击文件名全屏预览)</summary>
      <div className={styles.videoListGrid} aria-label="素材清单">
        {PARADIGM_EMOTION_DISPLAY_ORDER.map((emotion) => {
          const entries = library[libraryClassKeys[emotion]];

          return (
            <div key={emotion} className={styles.videoListGroup}>
              <span className={styles.videoListHeader}>
                {paradigmEmotionLabels[emotion]}({entries.length})
              </span>
              {entries.map((entry) => {
                const isSelected = selectedVideoIds.has(entry.videoId);

                return (
                  <button
                    key={entry.fileName}
                    type="button"
                    className={styles.videoListRow}
                    onClick={() => onSelectPreview(emotion, entry)}
                  >
                    <span className={styles.videoListName}>{entry.fileName}</span>
                    {isSelected ? (
                      <span className={styles.selectedVideoBadge}>入选</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </details>
  );
});
