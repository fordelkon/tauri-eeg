import { convertFileSrc } from '@tauri-apps/api/core';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { ParadigmVideoEntry } from '../../paradigm/types';
import { isTauriAvailable } from '../../ui/tauriEnvironment';
import { useParticipantFullscreen } from './useParticipantFullscreen';
import styles from './EffectEvaluation.module.css';

type EffectFullscreenInductionProps = {
  entry: ParadigmVideoEntry;
  isPlaying: boolean;
  onError: () => void;
  onPlaying: () => void;
  interrupted: boolean;
  startError: string | null;
  isStarting: boolean;
  onReset: () => void;
  onFinished: () => void;
  onStartPlayback: () => void;
  retryCount: number;
  subjectId: string;
};

function toPlayableInductionUrl(sourcePath: string) {
  if (isTauriAvailable()) {
    return convertFileSrc(sourcePath);
  }

  return /^[a-zA-Z]:\\/.test(sourcePath) ? `file:///${sourcePath.replace(/\\/g, '/')}` : sourcePath;
}

/** Participant-facing induction presentation with an explicit ready cue. */
export function EffectFullscreenInduction({
  entry,
  isPlaying,
  onError,
  onFinished,
  onPlaying,
  interrupted,
  startError,
  isStarting,
  onReset,
  onStartPlayback,
  retryCount,
  subjectId,
}: EffectFullscreenInductionProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onsetRef = useRef(false);
  const [isMediaReady, setIsMediaReady] = useState(false);
  const { enterFullscreen } = useParticipantFullscreen();

  useEffect(() => {
    if (interrupted) {
      videoRef.current?.pause();
      return;
    }
    if (isPlaying) {
      void videoRef.current?.play().catch(onError);
    }
  }, [isPlaying, onError, interrupted]);

  const handleStartPlayback = () => {
    void enterFullscreen();
    onStartPlayback();
  };

  return createPortal(
    <section className={styles.fullscreenRegulationStage} aria-label="诱发视频呈现">
      {interrupted ? (
        <div className={styles.fullscreenStageNotice} role="alert">
          <strong>本次实验已中断</strong>
          <span>请检查 Trigger 和素材，重新开始实验。外部 BDF 继续由 ActiView 管理。</span>
          <button type="button" className={styles.fullscreenStagePrimaryAction} onClick={onReset}>
            重置本次实验
          </button>
        </div>
      ) : null}
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
          onPlaying={() => {
            if (!onsetRef.current && !interrupted) {
              onsetRef.current = true;
              onPlaying();
            }
          }}
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
              disabled={!isMediaReady || interrupted || isStarting}
              onClick={handleStartPlayback}
            >
              {isStarting ? '正在创建实验并发送开始标记…' : '开始播放诱发视频'}
            </button>
          </div>
        ) : null}
      </div>

      {startError ? (
        <p className={styles.fullscreenStageNotice} role="alert">
          {startError}
        </p>
      ) : null}
      <footer className={styles.fullscreenStageFooter}>
        <span className={styles.fullscreenPlaybackHint}>
          {isPlaying ? `正在播放：${entry.fileName}` : '首次播放时发送诱发开始标记。'}
        </span>
      </footer>
    </section>,
    document.body,
  );
}
