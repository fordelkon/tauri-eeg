import { useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import Button from '@mui/material/Button';
import { useAuth } from '../../auth/AuthContext';
import { toPlayableVideoUrl } from '../../video/videoRegulationCatalog';
import type { EffectRegulationMethod } from './effectEvaluationFlow';
import {
  MUSIC_HISTORY_PLAYER_LIMIT,
  trimMusicHistoryForPlayer,
} from './effectRegulationPlayerModel';
import { useMusicHistory } from './useMusicHistory';
import styles from './EffectEvaluation.module.css';

type Props = {
  method: EffectRegulationMethod;
  remainingSeconds: number | null;
  interrupted?: boolean;
  onPlaying: (mediaId: string, details?: unknown) => void;
  onError: () => void;
};
export default function EffectRegulationPlayer({
  remainingSeconds,
  interrupted,
  onPlaying,
  onError,
}: Props) {
  const { currentUser } = useAuth();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onsetRef = useRef(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { items, isLoading } = useMusicHistory({
    userId: currentUser?.id,
    limit: MUSIC_HISTORY_PLAYER_LIMIT,
    reloadKey: 0,
    onError: () => setError('音乐历史加载失败，请重置后重试。'),
  });
  const tracks = useMemo(
    () => trimMusicHistoryForPlayer(items, MUSIC_HISTORY_PLAYER_LIMIT),
    [items],
  );
  const active = tracks.find((item) => item.id === activeId);
  useEffect(() => {
    if (remainingSeconds === 0 || interrupted) audioRef.current?.pause();
  }, [remainingSeconds, interrupted]);
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
    };
  }, [activeId]);
  const start = () => {
    if (!ready || !active || interrupted) return;
    setRequested(true);
    void audioRef.current?.play().catch(() => {
      setError('音乐播放失败，本次实验中断。');
      onError();
    });
  };
  return (
    <section className={styles.regulationPlayer} aria-label="音乐调控准备与播放">
      <p className={styles.panelHint}>
        先选择并预载音乐。音频开始播放后才开始调控计时；运行中固定曲目。
      </p>
      {isLoading ? <p role="status">正在加载音乐历史…</p> : null}
      {!isLoading && tracks.length === 0 ? (
        <p role="alert">暂无可播放音乐，请先在音乐调控页生成素材，再开始新的实验。</p>
      ) : null}
      <ul className={styles.musicHistoryList}>
        {tracks.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={`${styles.musicHistoryItem} ${activeId === item.id ? styles.musicHistoryItemActive : ''}`}
              disabled={requested || interrupted}
              aria-pressed={activeId === item.id}
              onClick={() => {
                setReady(false);
                setActiveId(item.id);
              }}
            >
              {item.prompt.trim() || item.filePath.split(/[\\/]/).pop()}
            </button>
          </li>
        ))}
      </ul>
      {active ? (
        <audio
          key={active.id}
          ref={audioRef}
          src={toPlayableVideoUrl(active.filePath, convertFileSrc)}
          preload="auto"
          loop
          onCanPlay={() => setReady(true)}
          onPlaying={() => {
            if (!onsetRef.current) {
              onsetRef.current = true;
              onPlaying(active.id, { path: active.filePath, prompt: active.prompt });
            }
          }}
          onError={() => {
            setError('音乐文件不可用，本次实验中断。');
            onError();
          }}
        />
      ) : null}
      {!requested ? (
        <Button variant="contained" disabled={!ready || interrupted} onClick={start}>
          {ready ? '开始播放并计时' : '选择音乐并等待预载'}
        </Button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
