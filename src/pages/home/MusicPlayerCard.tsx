import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import QueueMusicRoundedIcon from '@mui/icons-material/QueueMusicRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import SkipPreviousRoundedIcon from '@mui/icons-material/SkipPreviousRounded';
import { IconButton } from '@mui/material';
import type { CSSProperties } from 'react';
import type { MusicAsset } from '../../music/musicAssets';
import { PlaybackTimeline } from './MusicPlaybackTimeline';
import styles from './MusicRegulation.module.css';

/**
 * The WAV player card of the music regulation page (cover, transport
 * controls, queue entry). Presentational: playback state, the active asset,
 * and all handlers come from the page.
 */

type MusicPlayerCardProps = {
  activeAsset: MusicAsset | undefined;
  assetCount: number;
  activeIndex: number;
  isPlaying: boolean;
  audioRef: { current: HTMLAudioElement | null };
  coverStyle: CSSProperties | undefined;
  onTogglePlay: () => void;
  onTrackChange: (nextIndex: number) => void;
  onOpenHistory: () => void;
};

export function MusicPlayerCard({
  activeAsset,
  assetCount,
  activeIndex,
  isPlaying,
  audioRef,
  coverStyle,
  onTogglePlay,
  onTrackChange,
  onOpenHistory,
}: MusicPlayerCardProps) {
  return (
    <div className={styles.playerCard} style={coverStyle}>
      <button
        className={styles.coverButton}
        type="button"
        data-agent-action="play_music"
        aria-label={isPlaying ? '暂停 WAV' : '播放 WAV'}
        onClick={onTogglePlay}
      >
        <span className={styles.coverArt} aria-hidden="true">
          <span className={styles.coverBars}>
            <span />
            <span />
            <span />
            <span />
          </span>
        </span>
      </button>

      <div className={styles.playerMain}>
        <div className={styles.playerTop}>
          <div className={styles.playerMeta}>
            <strong>{activeAsset?.title || '未选择 WAV'}</strong>
            <span>{activeAsset?.source === 'generated' ? '生成的 WAV' : 'WAV 音频流'}</span>
          </div>
          <div className={styles.trackCounter}>
            {assetCount > 0 ? `${activeIndex + 1}/${assetCount}` : '0/0'}
          </div>
        </div>

        <PlaybackTimeline key={activeAsset?.id ?? 'none'} audioRef={audioRef} />

        <div className={styles.controls}>
          <div className={styles.transportControls}>
            <IconButton
              className={styles.controlButton}
              aria-label="上一首 WAV"
              disabled={assetCount === 0}
              onClick={() => onTrackChange(activeIndex - 1)}
            >
              <SkipPreviousRoundedIcon />
            </IconButton>
            <IconButton
              className={`${styles.controlButton} ${styles.primaryButton}`}
              data-agent-action="play_music"
              aria-label={isPlaying ? '暂停 WAV' : '播放 WAV'}
              disabled={assetCount === 0}
              onClick={onTogglePlay}
            >
              {isPlaying ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
            </IconButton>
            <IconButton
              className={styles.controlButton}
              aria-label="下一首 WAV"
              disabled={assetCount === 0}
              onClick={() => onTrackChange(activeIndex + 1)}
            >
              <SkipNextRoundedIcon />
            </IconButton>
          </div>

          <IconButton
            className={styles.controlButton}
            aria-label="打开生成的 WAV 记录"
            onClick={onOpenHistory}
          >
            <QueueMusicRoundedIcon />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
