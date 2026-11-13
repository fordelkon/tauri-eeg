import { convertFileSrc } from '@tauri-apps/api/core';
import { useState, type Ref } from 'react';
import Modal from '@mui/material/Modal';
import type { RegulationVideo } from '../../video/paradigmRegulationCatalog';
import { toPlayableVideoUrl } from '../../video/videoRegulationCatalog';
import playerStyles from './VideoRegulationPlayer.module.css';

type VideoRegulationPlayerModalProps = {
  activeVideo: RegulationVideo;
  videoRef: Ref<HTMLVideoElement>;
  onClose: () => void;
};

export function VideoRegulationPlayerModal({
  activeVideo,
  videoRef,
  onClose,
}: VideoRegulationPlayerModalProps) {
  const [failed, setFailed] = useState(false);
  return (
    <Modal open hideBackdrop onClose={onClose}>
      <section
        className={playerStyles.player}
        role="dialog"
        aria-modal="true"
        aria-label="视频调节播放器"
      >
        <button
          type="button"
          className={playerStyles.surface}
          autoFocus
          aria-label="关闭调节视频"
          onClick={onClose}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            disablePictureInPicture
            disableRemotePlayback
            onContextMenu={(event) => event.preventDefault()}
            preload="auto"
            src={toPlayableVideoUrl(activeVideo.sourcePath, convertFileSrc)}
            onEnded={onClose}
            onError={() => setFailed(true)}
          />
        </button>
        {failed && (
          <div className={playerStyles.error} role="alert">
            <p>视频无法播放，请检查素材后重试。</p>
            <button type="button" onClick={onClose}>
              返回素材列表
            </button>
          </div>
        )}
      </section>
    </Modal>
  );
}
