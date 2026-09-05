import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useAuth } from '../../auth/AuthContext';
import type { GeneratedMusicHistoryItem } from '../../music/musicAssets';
import { listMusicHistory } from '../../music/musicGenerationApi';
import {
  getAllVideoRegulationAssets,
  toPlayableVideoUrl,
  type VideoRegulationAsset,
} from '../../video/videoRegulationCatalog';
import type { EffectRegulationMethod } from './effectEvaluationFlow';
import {
  cycleVideoIndex,
  formatMusicDurationLabel,
  formatMusicHistoryTime,
  MUSIC_HISTORY_PLAYER_LIMIT,
  selectDefaultVideoIndex,
  shouldPauseAt,
  trimMusicHistoryForPlayer,
} from './effectRegulationPlayerModel';
import styles from './EffectEvaluation.module.css';

/**
 * Embedded regulation player for the condition node (调控条件): instead of
 * forcing the jump to the standalone music/video page, the condition card
 * hosts the regulation media itself while the wizard's wall-clock window
 * ticks down. The standalone path stays available side by side (the existing
 * 前往{methodLabel} button); navigating away unmounts this player and thereby
 * stops its media naturally.
 *
 * The player is deliberately frugal (experiment posture): loop + autoplay at
 * fixed volume 1, no volume/progress controls — the countdown owns the exit,
 * and once `remainingSeconds` reads 0 (hard floor, same rule that unlocks the
 * finish button) playback pauses and stays stopped.
 */

export type EffectRegulationPlayerProps = {
  method: EffectRegulationMethod;
  /** Seconds left in the condition window (null before it started). */
  remainingSeconds: number | null;
};

export default function EffectRegulationPlayer({
  method,
  remainingSeconds,
}: EffectRegulationPlayerProps) {
  // The to-zero rule lives in the pure helper so the countdown contract is
  // unit-testable without mounting this component.
  const shouldPause = shouldPauseAt(remainingSeconds);

  return (
    <Box className={styles.regulationPlayer} aria-label="内嵌调控播放器">
      <p className={styles.panelHint}>
        {method === 'video'
          ? '内嵌视频调控：循环播放调控素材，计时归零后自动暂停；也可在下方切换素材或前往独立页面。'
          : '内嵌音乐调控：从最近生成的音乐中选择一条循环播放，计时归零后自动暂停；也可前往独立页面。'}
      </p>
      {method === 'video'
        ? <EmbeddedVideoPlayer shouldPause={shouldPause} />
        : <EmbeddedMusicPlayer shouldPause={shouldPause} />}
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/* Video branch: default video_database catalog with prev/next cycling */
/* ------------------------------------------------------------------ */

function EmbeddedVideoPlayer({ shouldPause }: { shouldPause: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // The default catalog (project video_database root) is stable for the whole
  // run; the operator just cycles it, so no tag/scene selection here.
  const assets = useMemo(() => getAllVideoRegulationAssets(), []);
  const [index, setIndex] = useState(() => selectDefaultVideoIndex(assets));
  const [loadFailed, setLoadFailed] = useState(false);
  const activeAsset: VideoRegulationAsset | null = index >= 0 ? assets[index] ?? null : null;

  // Pause the outgoing element when the asset changes or the player unmounts;
  // a removed <video> element would otherwise keep decoding (same guard as
  // the standalone video page).
  useEffect(() => {
    const video = videoRef.current;

    return () => {
      video?.pause();
    };
  }, [activeAsset?.id]);

  // Experiment posture: fixed volume 1 for every mounted asset.
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = 1;
    }
  }, [activeAsset?.id]);

  // Hard-floor rule at remaining 0 — also re-stops an element that just
  // mounted after the deadline (operator switching assets past the end).
  useEffect(() => {
    if (shouldPause) {
      videoRef.current?.pause();
    }
  }, [shouldPause, activeAsset?.id]);

  const stepAsset = useCallback((delta: 1 | -1) => {
    setLoadFailed(false);
    setIndex((current) => cycleVideoIndex(current, assets.length, delta));
  }, [assets.length]);

  if (!activeAsset) {
    return (
      <p className={styles.panelHint} role="note">
        视频素材库为空，请先在素材库目录补齐调控视频后重试。
      </p>
    );
  }

  return (
    <div className={styles.regulationPlayerStage}>
      <video
        key={activeAsset.id}
        ref={videoRef}
        className={styles.regulationPlayerVideo}
        src={toPlayableVideoUrl(activeAsset.sourcePath, convertFileSrc)}
        loop
        autoPlay
        playsInline
        preload="auto"
        onError={() => setLoadFailed(true)}
      />
      {loadFailed ? (
        <p className={styles.panelHint} role="alert">
          调控视频加载失败（文件可能已被移动或损坏），请用「上一个 / 下一个」切换其他素材。
        </p>
      ) : null}
      <div className={styles.actionsRow}>
        <Button
          variant="outlined"
          disabled={assets.length < 2}
          onClick={() => stepAsset(-1)}
        >
          上一个
        </Button>
        <span className={styles.configChip}>
          {activeAsset.title}（{index + 1}/{assets.length}）
        </span>
        <Button
          variant="outlined"
          disabled={assets.length < 2}
          onClick={() => stepAsset(1)}
        >
          下一个
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Music branch: recent music_history entries, click to loop           */
/* ------------------------------------------------------------------ */

function EmbeddedMusicPlayer({ shouldPause }: { shouldPause: boolean }) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // null = still loading; [] = loaded but empty (drives the guidance copy).
  const [historyItems, setHistoryItems] = useState<GeneratedMusicHistoryItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  // Load the most recent history once (backend orders by created_at DESC and
  // the pure helper trims to the player limit); failures degrade to guidance.
  useEffect(() => {
    if (!currentUser) {
      setHistoryItems([]);
      return undefined;
    }

    let cancelled = false;

    listMusicHistory(currentUser.id, MUSIC_HISTORY_PLAYER_LIMIT)
      .then((items) => {
        if (!cancelled) {
          setHistoryItems(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('音乐历史加载失败，请稍后重试或前往音乐页查看。');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const visibleItems = useMemo(
    () => trimMusicHistoryForPlayer(historyItems ?? [], MUSIC_HISTORY_PLAYER_LIMIT),
    [historyItems],
  );
  const activeItem = visibleItems.find((item) => item.id === activeItemId) ?? null;

  // Pause the audio when the selection changes or the player unmounts.
  useEffect(() => {
    const audio = audioRef.current;

    return () => {
      audio?.pause();
    };
  }, [activeItemId]);

  // Hard-floor rule at remaining 0: pause now and keep stopped (the selection
  // play effect below refuses to start while the window has elapsed).
  useEffect(() => {
    if (shouldPause) {
      audioRef.current?.pause();
    }
  }, [shouldPause, activeItemId]);

  // Declarative track switch: the <audio> src is bound in JSX, so once the
  // element re-rendered with the selected track, start loop playback. play()
  // rides the transient user activation of the click that set the selection.
  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !activeItem || shouldPause) {
      return;
    }

    void audio.play().catch(() => {
      setPlayError('无法播放音频，请检查音频文件或系统音频权限。');
    });
  }, [activeItem, shouldPause]);

  const handleSelectTrack = (itemId: string) => {
    setPlayError(null);

    if (itemId === activeItemId) {
      const audio = audioRef.current;

      // Second click on the active track toggles pause/resume — except past
      // the deadline, where playback must stay stopped.
      if (audio?.paused && !shouldPause) {
        void audio.play().catch(() => {
          setPlayError('无法播放音频，请检查音频文件或系统音频权限。');
        });
      } else {
        audio?.pause();
      }

      return;
    }

    setActiveItemId(itemId);
  };

  if (historyItems === null && !loadError) {
    return <p className={`${styles.panelHint} ${styles.loadingHint}`}>正在加载音乐历史…</p>;
  }

  if (loadError) {
    return <p className={styles.panelHint} role="alert">{loadError}</p>;
  }

  if (visibleItems.length === 0) {
    return (
      <div className={styles.regulationPlayerStage}>
        <p className={styles.panelHint} role="note">
          暂无可播放的音乐历史。请先到音乐调控页生成一段音乐，再回到本节点选择播放。
        </p>
        <div className={styles.actionsRow}>
          <Button variant="outlined" onClick={() => navigate('/music-regulation')}>
            去音乐页生成
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.regulationPlayerStage}>
      <ul className={styles.musicHistoryList} aria-label="最近生成的音乐">
        {visibleItems.map((item) => {
          const isActive = item.id === activeItemId;
          const pathParts = item.filePath.split(/[\\/]/);
          const fileName = pathParts[pathParts.length - 1] || item.id;
          const title = item.prompt.trim() || fileName;

          return (
            <li key={item.id}>
              <button
                type="button"
                className={`${styles.musicHistoryItem} ${isActive ? styles.musicHistoryItemActive : ''}`}
                aria-pressed={isActive}
                onClick={() => handleSelectTrack(item.id)}
              >
                <span className={styles.musicHistoryItemTitle}>
                  {isActive ? '♪ ' : ''}{title}
                </span>
                <span className={styles.musicHistoryItemMeta}>
                  {formatMusicHistoryTime(item.createdAt)} · {formatMusicDurationLabel(item.durationSeconds)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {playError ? <p className={styles.panelHint} role="alert">{playError}</p> : null}
      {activeItem ? (
        <audio
          ref={audioRef}
          src={toPlayableVideoUrl(activeItem.filePath, convertFileSrc)}
          loop
          preload="auto"
        />
      ) : null}
    </div>
  );
}
