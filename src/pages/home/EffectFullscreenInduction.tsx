import { convertFileSrc } from '@tauri-apps/api/core';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { ParadigmVideoEntry } from '../../eeg/paradigm/types';
import { isTauriAvailable } from '../../ui/tauriEnvironment';
import { useParticipantFullscreen } from './useParticipantFullscreen';
import styles from './EffectEvaluation.module.css';

type EffectFullscreenInductionProps = {
  entry: ParadigmVideoEntry;
  isPlaying: boolean;
  onError: () => void;
  onFinished: () => void;
  onStartPlayback: () => void;
  retryCount: number;
  subjectId: string;
};

function toPlayableInductionUrl(sourcePath: string) {
  if (isTauriAvailable()) {
    return convertFileSrc(sourcePath);
  }

  return /^[a-zA-Z]:\\/.test(sourcePath)
    ? `file:///${sourcePath.replace(/\\/g, '/')}`
    : sourcePath;
}

/** Participant-facing induction presentation with an explicit ready cue. */
export function EffectFullscreenInduction({
  entry,
  isPlaying,
  onError,
  onFinished,
  onStartPlayback,
  retryCount,
  subjectId,
}: EffectFullscreenInductionProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isMediaReady, setIsMediaReady] = useState(false);
  const { enterFullscreen } = useParticipantFullscreen();

  useEffect(() => {
    if (isPlaying) {
      void videoRef.current?.play().catch(onError);
    }
  }, [isPlaying, onError]);

  const handleStartPlayback = () => {
    void enterFullscreen();
    onStartPlayback();
  };

  return createPortal(
    <section className={styles.fullscreenRegulationStage} aria-label="诱发视频呈现">
      <header className={styles.fullscreenStageHeader}>
        <span>{isPlaying ? '诱发视频进行中' : '准备播放诱发视频'}</span>
        <span aria-label={`被试 ${subjectId}`}>被试 {subjectId}</span>
      </header>

      <div className={styles.fullscreenVideoFrame}>
        <video
          key={`${entry.videoId}-${retryCount}`}
          ref={videoRef}
          className={isPlaying ? styles.fullscreenRegulationVideo : styles.fullscreenPreloadedVideo}
          src={toPlayableInductionUrl(entry.absolutePath)}
          autoPlay={isPlaying}
          playsInline
          preload="auto"
          onCanPlay={() => setIsMediaReady(true)}
          onEnded={onFinished}
          onError={onError}
        />
        {!isPlaying ? (
          <div className={styles.fullscreenReadyCue} role="status">
            <span>{isMediaReady ? '诱发素材已就绪' : '正在预载诱发素材…'}</span>
            <h2>准备播放诱发视频</h2>
            <p>确认受试者状态稳定后开始。播放结束将自动进入诱发后测量。</p>
            <button
              type="button"
              className={styles.fullscreenStagePrimaryAction}
              disabled={!isMediaReady}
              onClick={handleStartPlayback}
            >
              开始播放诱发视频
            </button>
          </div>
        ) : null}
      </div>

      <footer className={styles.fullscreenStageFooter}>
        <span className={styles.fullscreenPlaybackHint}>
          {isPlaying ? `正在播放：${entry.fileName}` : '播放前不会开始 EEG 诱发记录。'}
        </span>
      </footer>
    </section>,
    document.body,
  );
}
