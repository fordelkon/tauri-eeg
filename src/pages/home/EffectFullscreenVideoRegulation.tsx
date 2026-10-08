import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { isTauriAvailable } from '../../ui/tauriEnvironment';
import type { ParadigmVideoEntry } from '../../eeg/paradigm/types';
import type { EffectEvaluationFlowState, RegulationFinishMode } from './effectEvaluationFlow';
import { ConditionCountdown } from './EffectConditionCountdown';
import { selectDefaultVideoIndex, shouldPauseAt } from './effectRegulationPlayerModel';
import { usePauseMediaOnChange } from './useRegulationMedia';
import { useParticipantFullscreen } from './useParticipantFullscreen';
import styles from './EffectEvaluation.module.css';

type EffectFullscreenVideoRegulationProps = {
  assets: readonly ParadigmVideoEntry[];
  finishMode: RegulationFinishMode;
  onFinish: () => void;
  onSkip: () => void;
  onWindowElapsed: () => void;
  onStartPlayback: () => void;
  isPlaying: boolean;
  state: EffectEvaluationFlowState;
  windowNoun: string;
};

function toPlayableParadigmVideoUrl(sourcePath: string) {
  if (isTauriAvailable()) {
    return convertFileSrc(sourcePath);
  }

  return /^[a-zA-Z]:\\/.test(sourcePath)
    ? `file:///${sourcePath.replace(/\\/g, '/')}`
    : sourcePath;
}

/**
 * Subject-facing presentation for the video branch of a live effect run.
 * It is mounted only while step 3 is active, so the flow's stamped start time
 * remains the single clock and unmounting always returns the app to its normal
 * evaluation layout.
 */
export function EffectFullscreenVideoRegulation({
  assets,
  finishMode,
  onFinish,
  onSkip,
  onStartPlayback,
  onWindowElapsed,
  isPlaying,
  state,
  windowNoun,
}: EffectFullscreenVideoRegulationProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isMediaReady, setIsMediaReady] = useState(false);
  const activeAsset = assets[selectDefaultVideoIndex(assets)] ?? null;
  const shouldPause = shouldPauseAt(isPlaying && finishMode.mode === 'finish' ? 0 : null);
  const { enterFullscreen } = useParticipantFullscreen();

  usePauseMediaOnChange(videoRef, activeAsset?.videoId);

  useEffect(() => {
    if (shouldPause) {
      videoRef.current?.pause();
    }
  }, [shouldPause]);

  useEffect(() => {
    if (isPlaying) {
      void videoRef.current?.play().catch(() => setLoadFailed(true));
    }
  }, [isPlaying, activeAsset?.videoId]);

  const handleStartPlayback = () => {
    void enterFullscreen();
    onStartPlayback();
  };

  return createPortal(
    <section
      className={styles.fullscreenRegulationStage}
      aria-label="视频调控进行中"
    >
      <header className={styles.fullscreenStageHeader}>
        <span>{isPlaying ? '视频调控进行中' : '准备播放调控视频'}</span>
        <span aria-label={`被试 ${state.subjectId}`}>被试 {state.subjectId}</span>
      </header>

      <div className={styles.fullscreenVideoFrame}>
        {isPlaying && activeAsset ? (
          <video
            key={activeAsset.videoId}
            ref={videoRef}
            className={styles.fullscreenRegulationVideo}
            src={toPlayableParadigmVideoUrl(activeAsset.absolutePath)}
            autoPlay
            loop
            playsInline
            preload="auto"
            onCanPlay={() => setIsMediaReady(true)}
            onError={() => setLoadFailed(true)}
          />
        ) : null}

        {!isPlaying && activeAsset ? (
          <video
            key={activeAsset.videoId}
            ref={videoRef}
            className={styles.fullscreenPreloadedVideo}
            src={toPlayableParadigmVideoUrl(activeAsset.absolutePath)}
            playsInline
            preload="auto"
            onCanPlay={() => setIsMediaReady(true)}
            onError={() => setLoadFailed(true)}
          />
        ) : null}

        {!isPlaying && activeAsset ? (
          <div className={styles.fullscreenReadyCue} role="status">
            <span>{isMediaReady ? '平静调控素材已就绪' : '正在预载平静调控素材…'}</span>
            <h2>准备播放调控视频</h2>
            <p>确认受试者准备完成后开始。开始播放时同步开始调控计时。</p>
            <button
              type="button"
              className={styles.fullscreenStagePrimaryAction}
              disabled={!isMediaReady}
              onClick={handleStartPlayback}
            >
              开始播放调控视频
            </button>
          </div>
        ) : null}

        {!activeAsset || loadFailed ? (
          <div className={styles.fullscreenStageNotice} role="alert">
          <strong>调控视频不可用</strong>
          <span>请检查视频素材库。素材未准备完成前不会开始调控计时。</span>
          </div>
        ) : null}
      </div>

      <footer className={styles.fullscreenStageFooter}>
        {isPlaying ? (
          <ConditionCountdown
            state={state}
            windowNoun={windowNoun}
            onElapsed={onWindowElapsed}
            compact
          />
        ) : (
          <span className={styles.fullscreenPlaybackHint}>播放前不会开始调控计时。</span>
        )}
        {isPlaying ? (
          <div className={styles.fullscreenStageActions}>
          {finishMode.mode === 'finish' ? (
            <button type="button" className={styles.fullscreenStagePrimaryAction} onClick={onFinish}>
              结束调控，进行复测
            </button>
          ) : null}
          {finishMode.mode === 'requires-skip' ? (
            <button type="button" className={styles.fullscreenStageSecondaryAction} onClick={onSkip}>
              跳过剩余时长…
            </button>
          ) : null}
          </div>
        ) : null}
      </footer>
    </section>,
    document.body,
  );
}
