import { memo, useEffect, useState } from 'react';
import { formatTime } from './musicRegulationOptions';
import styles from './MusicRegulation.module.css';

/**
 * Generation wait panel for the music regulation page. Owns the generation
 * wait timer so its 500ms ticks re-render only this subtree instead of the
 * whole page during a long generation. The backend has no progress events
 * (the /generate call resolves once, at completion), so this is an honest
 * elapsed-time counter rather than a simulated percentage. There is also no
 * cancel endpoint, so cancelling only gives up the wait — the job keeps
 * running server-side and still lands in history via MUSIC_GENERATED_EVENT.
 */
export const GenerationProgressPanel = memo(function GenerationProgressPanel({
  deviceLabel,
  onCancel,
}: {
  deviceLabel: string;
  onCancel: () => void;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setElapsedSeconds((Date.now() - startedAt) / 1000);
    }, 500);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className={`${styles.generationProgress} grid`} aria-live="polite">
      <div className={`${styles.generationProgressHeader} flex items-center justify-between`}>
        <span>正在生成 WAV - {deviceLabel}</span>
        <strong>已等待 {formatTime(elapsedSeconds)}</strong>
      </div>
      <p className={styles.generationHint}>
        可以离开本页，任务会在后台继续生成，完成后曲目自动出现在「生成记录」中。
      </p>
      <button className={styles.cancelGenerationButton} type="button" onClick={onCancel}>
        取消等待
      </button>
    </div>
  );
});
