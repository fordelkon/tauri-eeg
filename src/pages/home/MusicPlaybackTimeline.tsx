import { memo, useEffect, useState } from 'react';
import { formatTime } from './musicRegulationOptions';
import styles from './MusicRegulation.module.css';

/**
 * Playback time display for the music regulation page. `timeupdate` fires
 * ~4Hz during playback, so keeping currentTime/duration local to this
 * memoized subtree prevents the full page from re-rendering on every tick.
 */
export const PlaybackTimeline = memo(function PlaybackTimeline({
  audioRef,
}: {
  audioRef: { current: HTMLAudioElement | null };
}) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const remainingTime = Math.max(0, duration - currentTime);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      setCurrentTime(0);
      setDuration(0);
      return undefined;
    }

    const syncFromElement = () => {
      setCurrentTime(audio.currentTime);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', syncFromElement);
    audio.addEventListener('emptied', syncFromElement);
    syncFromElement();

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', syncFromElement);
      audio.removeEventListener('emptied', syncFromElement);
    };
  }, [audioRef]);

  const handleSeek = (value: number) => {
    const audio = audioRef.current;

    if (!audio || duration <= 0) {
      return;
    }

    audio.currentTime = (value / 100) * duration;
  };

  return (
    <div className={styles.timelineRow}>
      <span>{formatTime(currentTime)}</span>
      <input
        className={styles.timeline}
        type="range"
        min="0"
        max="100"
        value={progress}
        aria-label="播放位置"
        style={{ '--progress': `${progress}%` } as import('react').CSSProperties}
        onChange={(event) => handleSeek(Number(event.currentTarget.value))}
      />
      <span>-{formatTime(remainingTime)}</span>
    </div>
  );
});
