import { canUseRehearsalTools } from '../../experiment/buildMode';
import { ParticipantVideoStage } from './ParticipantVideoStage';
import { useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { isTauriAvailable } from '../../ui/tauriEnvironment';
import { useFirstVideoFrameOnset } from '../../ui/videoFrameOnset';
import type { ParadigmVideoEntry } from '../../paradigm/types';
import type { EffectEvaluationFlowState, RegulationFinishMode } from './effectEvaluationFlow';
import { ConditionCountdown } from './EffectConditionCountdown';
import { selectDefaultVideoIndex, shouldPauseAt } from './effectRegulationPlayerModel';
import { usePauseMediaOnChange } from './useRegulationMedia';
import { TEST_SKIP_LABEL, useTestSkip } from './useTestSkip';
import { useParticipantFullscreen } from './useParticipantFullscreen';
import styles from './EffectEvaluation.module.css';

type EffectFullscreenVideoRegulationProps = {
  assets: readonly ParadigmVideoEntry[];
  finishMode: RegulationFinishMode;
  onFinish: () => void;
  interrupted: boolean;
  onReset: () => void;
  onExit: () => void;
  onPlaying: (mediaId: string, details?: unknown) => void;
  onError: () => void;
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

  return /^[a-zA-Z]:\\/.test(sourcePath) ? `file:///${sourcePath.replace(/\\/g, '/')}` : sourcePath;
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
  interrupted,
  onReset,
  onExit,
  onPlaying,
  onError,
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
  const handleFirstPlaying = useFirstVideoFrameOnset((onset) => {
    if (!activeAsset) return;
    onPlaying(activeAsset.videoId, {
      path: activeAsset.absolutePath,
      fileName: activeAsset.fileName,
      onset,
    });
  });
  const shouldPause = shouldPauseAt(isPlaying && finishMode.mode === 'finish' ? 0 : null);
  const finishRequested = useRef(false);
  useTestSkip(
    canUseRehearsalTools(state.runMode) &&
      isPlaying &&
      !interrupted &&
      state.regulationStartedAtMs !== null &&
      finishMode.mode === 'requires-skip',
    onSkip,
  );
  const { enterFullscreen } = useParticipantFullscreen();

  usePauseMediaOnChange(videoRef, activeAsset?.videoId);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      setIsMediaReady(true);
    }
  }, [activeAsset?.videoId]);

  useEffect(() => {
    if (
      shouldPause &&
      !interrupted &&
      state.regulationStartedAtMs !== null &&
      !finishRequested.current
    ) {
      finishRequested.current = true;
      onFinish();
    }
  }, [shouldPause, interrupted, state.regulationStartedAtMs, onFinish]);

  useEffect(() => {
    if (shouldPause || interrupted) {
      videoRef.current?.pause();
    }
  }, [shouldPause, interrupted]);

  useEffect(() => {
    if (isPlaying && !interrupted) {
      void videoRef.current?.play().catch(() => {
        setLoadFailed(true);
        onError();
      });
    }
  }, [isPlaying, activeAsset?.videoId, interrupted, onError]);

  const handleStartPlayback = () => {
    void enterFullscreen();
    onStartPlayback();
  };

  return (
    <ParticipantVideoStage playing={isPlaying && !interrupted && !loadFailed} onExit={onExit}>
      {interrupted ? (
        <div className={styles.fullscreenStageNotice} role="alert">
          <strong>本次实验已中断</strong>
          <span>请检查 Trigger 和素材，重新开始实验。外部 BDF 继续由 ActiView 管理。</span>
          <button type="button" className={styles.fullscreenStagePrimaryAction} onClick={onReset}>
            重置本次实验
          </button>
        </div>
      ) : null}

      <div className={styles.fullscreenVideoFrame}>
        {activeAsset ? (
          <video
            key={activeAsset.videoId}
            ref={videoRef}
            className={
              isPlaying ? styles.fullscreenRegulationVideo : styles.fullscreenPreloadedVideo
            }
            src={toPlayableParadigmVideoUrl(activeAsset.absolutePath)}
            autoPlay={isPlaying}
            loop
            disablePictureInPicture
            disableRemotePlayback
            onContextMenu={(event) => event.preventDefault()}
            playsInline
            preload="auto"
            onCanPlay={() => setIsMediaReady(true)}
            onCanPlayThrough={() => setIsMediaReady(true)}
            onPlaying={(event) => {
              if (!interrupted) handleFirstPlaying(event.currentTarget);
            }}
            onError={() => {
              setLoadFailed(true);
              onError();
            }}
          />
        ) : null}

        {!isPlaying && activeAsset && !loadFailed && !interrupted ? (
          <div className={styles.fullscreenReadyCue} role="status">
            <span>{isMediaReady ? '视频已就绪' : '正在加载视频…'}</span>
            <h2>准备观看视频</h2>
            <p>计时将随播放开始。按 Esc 可中止本次实验。</p>
            {canUseRehearsalTools(state.runMode) && <p>排练中按 {TEST_SKIP_LABEL} 可跳过视频。</p>}
            <button
              type="button"
              className={styles.fullscreenStagePrimaryAction}
              disabled={!isMediaReady || interrupted}
              onClick={handleStartPlayback}
            >
              开始播放视频
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

      {state.regulationStartedAtMs !== null && !interrupted && (
        <ConditionCountdown
          state={state}
          windowNoun={windowNoun}
          onElapsed={onWindowElapsed}
          silent
        />
      )}
    </ParticipantVideoStage>
  );
}
