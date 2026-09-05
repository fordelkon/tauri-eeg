import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Ref } from 'react';
import type { VideoRegulationAsset } from '../../video/videoRegulationCatalog';
import { toPlayableVideoUrl } from '../../video/videoRegulationCatalog';
import playerStyles from './VideoRegulationPlayer.module.css';

/**
 * The fullscreen video player modal of the video regulation page. Presentational:
 * the active asset and the close handler come from the page (Escape key and
 * overlay dismissal live there too).
 */

type VideoRegulationPlayerModalProps = {
  activeVideo: VideoRegulationAsset;
  videoRef: Ref<HTMLVideoElement>;
  onClose: () => void;
};

export function VideoRegulationPlayerModal({
  activeVideo,
  videoRef,
  onClose,
}: VideoRegulationPlayerModalProps) {
  return (
    <div
      className={`${playerStyles.videoOverlay} fixed inset-0 z-30 flex items-center justify-center`}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className={`${playerStyles.videoModal} grid w-full`}
        aria-label="视频调节播放器"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={`${playerStyles.videoModalHeader} flex items-center justify-between`}>
          <div className="min-w-0">
            <span>视频播放</span>
            <strong>{activeVideo.title}</strong>
            <code>{activeVideo.sourcePath}</code>
          </div>
          <button
            type="button"
            className={playerStyles.closeButton}
            aria-label="关闭调节视频"
            onClick={onClose}
          >
            <CloseRoundedIcon />
          </button>
        </header>
        <div className={playerStyles.videoFrame}>
          <video
            key={activeVideo.id}
            ref={videoRef}
            autoPlay
            controls
            preload="metadata"
            src={toPlayableVideoUrl(activeVideo.sourcePath, convertFileSrc)}
          />
        </div>
      </section>
    </div>
  );
}
