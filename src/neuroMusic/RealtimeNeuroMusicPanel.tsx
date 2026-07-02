import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import { useEffect, useRef, useState } from 'react';
import type { UserProfile } from '../auth/types';
import { listenToEegSampleBlocks } from '../eeg/eegApi';
import type { EegSampleBlockPayload } from '../eeg/types';
import {
  getNeuroMusicHealth,
  predictEegEmotion,
  sendNeuroMusicEmotionControl,
  startNeuroMusicSession,
  stopNeuroMusicSession,
  type EegEmotionLabel,
  type NeuroMusicHealth,
  type NeuroMusicSessionStatus,
} from './neuroMusicApi';
import styles from './RealtimeNeuroMusicPanel.module.css';

type RealtimeNeuroMusicPanelProps = {
  currentUser: UserProfile | null;
};

const demoChannelIds = Array.from({ length: 32 }, (_, index) => `ch${String(index + 1).padStart(2, '0')}`);

function createDemoSamples() {
  return demoChannelIds.map((_, channelIndex) => (
    Array.from({ length: 50 }, (_value, sampleIndex) => (
      Math.sin((sampleIndex / 50) * Math.PI * 2 + channelIndex * 0.15) * 8
    ))
  ));
}

export default function RealtimeNeuroMusicPanel({ currentUser }: RealtimeNeuroMusicPanelProps) {
  const [health, setHealth] = useState<NeuroMusicHealth | null>(null);
  const [emotion, setEmotion] = useState<EegEmotionLabel | null>(null);
  const [session, setSession] = useState<NeuroMusicSessionStatus | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [autoEegEnabled, setAutoEegEnabled] = useState(false);
  const [liveBlockCount, setLiveBlockCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const lastLiveControlAtRef = useRef(0);
  const liveControlInFlightRef = useRef(false);

  const runAction = async (action: () => Promise<void>) => {
    setError(null);
    setIsBusy(true);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsBusy(false);
    }
  };

  const handleHealth = () => runAction(async () => {
    setHealth(await getNeuroMusicHealth());
  });

  const handleStart = () => runAction(async () => {
    if (!currentUser) {
      throw new Error('Sign in before starting realtime neuro music.');
    }

    const nextSession = await startNeuroMusicSession({
      mode: 'mock',
      prompt: 'instrumental emotional music, evolving, no vocals',
      userId: currentUser.id,
      username: currentUser.username,
    });
    setSession(nextSession);
    setHealth(await getNeuroMusicHealth());
  });

  const handleStop = () => runAction(async () => {
    setAutoEegEnabled(false);
    setSession(await stopNeuroMusicSession());
    setHealth(await getNeuroMusicHealth());
  });

  const handlePredictAndControl = () => runAction(async () => {
    const nextEmotion = await predictEegEmotion({
      channelIds: demoChannelIds,
      sampleRateHz: 1000,
      samples: createDemoSamples(),
      source: 'ui-demo-32ch-block',
      triggerClass: 2,
    });
    setEmotion(nextEmotion);

    const nextSession = await sendNeuroMusicEmotionControl({
      arousal: nextEmotion.arousal,
      emotion: nextEmotion.emotion,
      probabilities: nextEmotion.probabilities,
      valence: nextEmotion.valence,
    });
    setSession(nextSession);
  });

  useEffect(() => {
    if (!autoEegEnabled || !session?.active) {
      return undefined;
    }

    // This is the system bridge: subscribe to the existing Tauri EEG event
    // stream, throttle 50 ms display blocks to 1 Hz control updates, then
    // expose the emotion label for both music control and future video
    // recommendation consumers.
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const handleLiveBlock = (payload: EegSampleBlockPayload) => {
      const now = Date.now();
      if (now - lastLiveControlAtRef.current < 1000 || liveControlInFlightRef.current) {
        return;
      }

      lastLiveControlAtRef.current = now;
      liveControlInFlightRef.current = true;

      predictEegEmotion({
        channelIds: payload.channelIds,
        sampleRateHz: payload.sampleRateHz,
        samples: payload.samples,
        source: 'tauri-eeg-live-32ch',
        startedAtMs: payload.startedAtMs,
        triggerClass: payload.triggerClass ?? null,
      })
        .then(async (nextEmotion) => {
          if (disposed) {
            return;
          }
          setEmotion(nextEmotion);
          setLiveBlockCount((count) => count + 1);
          const nextSession = await sendNeuroMusicEmotionControl({
            arousal: nextEmotion.arousal,
            emotion: nextEmotion.emotion,
            probabilities: nextEmotion.probabilities,
            valence: nextEmotion.valence,
          });
          if (!disposed) {
            setSession(nextSession);
          }
        })
        .catch((reason) => {
          if (!disposed) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        })
        .finally(() => {
          liveControlInFlightRef.current = false;
        });
    };

    listenToEegSampleBlocks(handleLiveBlock)
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch((reason) => {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
      liveControlInFlightRef.current = false;
    };
  }, [autoEegEnabled, session?.active]);

  return (
    <section className={styles.panel} aria-label="Realtime EEG emotion music">
      <div className={styles.header}>
        <div>
          <span>Realtime Module</span>
          <strong>EEG Emotion Music</strong>
        </div>
        <span className={session?.active ? styles.livePill : styles.idlePill}>
          {session?.active ? 'Live' : 'Idle'}
        </span>
      </div>

      <div className={styles.metrics}>
        <div>
          <span>Emotion</span>
          <strong>{emotion?.emotion ?? 'No label'}</strong>
        </div>
        <div>
          <span>Confidence</span>
          <strong>{emotion ? `${Math.round(emotion.confidence * 100)}%` : '-'}</strong>
        </div>
        <div>
          <span>Mode</span>
          <strong>{session?.mode ?? 'mock'}</strong>
        </div>
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={handleHealth} disabled={isBusy}>
          <GraphicEqRoundedIcon fontSize="small" />
          Health
        </button>
        <button type="button" onClick={handleStart} disabled={isBusy || !currentUser || session?.active}>
          <BoltRoundedIcon fontSize="small" />
          Start
        </button>
        <button type="button" onClick={handlePredictAndControl} disabled={isBusy || !session?.active}>
          <GraphicEqRoundedIcon fontSize="small" />
          Send EEG
        </button>
        <button
          type="button"
          onClick={() => setAutoEegEnabled((enabled) => !enabled)}
          disabled={isBusy || !session?.active}
        >
          <BoltRoundedIcon fontSize="small" />
          {autoEegEnabled ? 'Live On' : 'Live EEG'}
        </button>
        <button type="button" onClick={handleStop} disabled={isBusy || !session?.active}>
          <StopRoundedIcon fontSize="small" />
          Stop
        </button>
      </div>

      <div className={styles.statusLine}>
        {health
          ? `${health.modelVersion} · DEMON ${health.demonControlAvailable ? 'available' : 'not attached'}`
          : 'Service not checked'}
      </div>
      <div className={styles.statusLine}>
        {autoEegEnabled ? `Live EEG bridge active · ${liveBlockCount} controlled blocks` : 'Live EEG bridge idle'}
      </div>
      {emotion?.note ? <div className={styles.note}>{emotion.note}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
    </section>
  );
}
