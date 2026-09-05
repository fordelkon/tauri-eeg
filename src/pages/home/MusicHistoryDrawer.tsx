import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { IconButton } from '@mui/material';
import type { MusicAsset } from '../../music/musicAssets';
import styles from './MusicRegulation.module.css';

/**
 * The generated-WAV history modal of the music regulation page. Presentational:
 * the queue, the active index, and the select/delete handlers come from the
 * page (selecting a track also closes the drawer there).
 */

type MusicHistoryDrawerProps = {
  assets: readonly MusicAsset[];
  activeIndex: number;
  deletingItemId: string | null;
  onClose: () => void;
  onSelectTrack: (index: number) => void;
  onDeleteItem: (itemId: string, index: number) => void;
};

export function MusicHistoryDrawer({
  assets,
  activeIndex,
  deletingItemId,
  onClose,
  onSelectTrack,
  onDeleteItem,
}: MusicHistoryDrawerProps) {
  return (
    <div
      className={`${styles.historyOverlay} fixed inset-0 z-20 flex items-center`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className={`${styles.historyModal} flex min-h-0 w-full flex-col`} aria-label="生成的 WAV 记录">
        <div className={`${styles.historyHeader} flex items-center justify-between`}>
          <div>
            <span>生成记录</span>
            <strong>生成的 WAV</strong>
          </div>
          <IconButton
            className={styles.closeButton}
            aria-label="关闭记录"
            onClick={onClose}
          >
            <CloseRoundedIcon />
          </IconButton>
        </div>
        <div className={`${styles.queueList} grid min-h-0 overflow-auto`}>
          {assets.length === 0 ? (
            <div className={styles.emptyQueue}>生成一首 WAV 后开始播放。</div>
          ) : assets.map((asset, index) => (
            <div
              key={asset.id}
              className={`${styles.queueItem} grid items-center ${index === activeIndex ? styles.activeQueueItem : ''}`}
            >
              <button
                className={`${styles.queueSelectButton} grid min-w-0 items-center border-0 bg-transparent text-left`}
                type="button"
                onClick={() => onSelectTrack(index)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{asset.title}</strong>
                {index === activeIndex ? (
                  <span className={styles.queueEqualizer} aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : null}
                <em>{asset.source === 'generated' ? '已生成' : '内置'}</em>
              </button>
              {asset.source === 'generated' ? (
                <IconButton
                  className={styles.deleteQueueButton}
                  aria-label={`删除 ${asset.title}`}
                  disabled={deletingItemId === asset.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteItem(asset.id, index);
                  }}
                >
                  <DeleteOutlineRoundedIcon />
                </IconButton>
              ) : (
                <span className={styles.queueSpacer} aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
