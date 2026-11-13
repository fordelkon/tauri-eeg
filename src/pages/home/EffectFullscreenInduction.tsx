import { convertFileSrc } from '@tauri-apps/api/core';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { ParadigmVideoEntry } from '../../paradigm/types';
import { isTauriAvailable } from '../../ui/tauriEnvironment';
import { useFirstVideoFrameOnset, type VideoOnsetInfo } from '../../ui/videoFrameOnset';
import { useParticipantFullscreen } from './useParticipantFullscreen';
import styles from './EffectEvaluation.module.css';

type EffectFullscreenInductionProps = {
  entry: ParadigmVideoEntry;
  isPlaying: boolean;
  onError: () => void;
  /** Fired once at the first presented frame (or its annotated fallback). */
  onPlaying: (onset: VideoOnsetInfo) => void;
  interrupted: boolean;
  startError: string | null;
  isStarting: boolean;
  onReset: () => void;
  onFinished: () => void;
  onStartPlayback: () => void;
  onReturnToSettings?: () => void;
  retryCount: number;
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
  onReturnToSettings,
  retryCount,
}: EffectFullscreenInductionProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handleFirstPlaying = useFirstVideoFrameOnset(onPlaying);
  const [isMediaReady, setIsMediaReady] = useState(false);
  const { enterFullscreen } = useParticipantFullscreen();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      setIsMediaReady(true);
    }
  }, []);

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

  const handleMediaReady = () => {
    setIsMediaReady(true);
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
        <span>{isPlaying ? '正在观看视频' : '准备观看视频'}</span>
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
          onCanPlay={(event) => {
            if (event.currentTarget.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
              handleMediaReady();
            }
          }}
          onCanPlayThrough={handleMediaReady}
          onLoadedData={(event) => {
            if (event.currentTarget.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
              handleMediaReady();
            }
          }}
          onPlaying={(event) => {
            if (!interrupted) handleFirstPlaying(event.currentTarget);
          }}
          onEnded={onFinished}
          onError={onError}
        />
        {!isPlaying ? (
          <div className={styles.fullscreenReadyCue} role="status">
            <span>{isMediaReady ? '视频已就绪' : '正在加载视频…'}</span>
            <h2>准备观看视频</h2>
            <p>准备好后点击播放。看完后请记录此刻的感受。</p>
            <button
              type="button"
              className={styles.fullscreenStagePrimaryAction}
              disabled={!isMediaReady || interrupted || isStarting}
              onClick={handleStartPlayback}
            >
              {isStarting ? '正在准备播放…' : '开始播放视频'}
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
        {!isPlaying && !isStarting && onReturnToSettings && (
          <button
            type="button"
            className={styles.fullscreenStageSecondaryAction}
            onClick={onReturnToSettings}
          >
            返回实验设置
          </button>
        )}
        <span className={styles.fullscreenPlaybackHint}>
          {isPlaying ? '正在播放视频' : '准备好后开始。'}
        </span>
      </footer>
    </section>,
    document.body,
  );
}
