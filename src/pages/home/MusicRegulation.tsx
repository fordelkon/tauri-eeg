import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import QueueMusicRoundedIcon from '@mui/icons-material/QueueMusicRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import SkipPreviousRoundedIcon from '@mui/icons-material/SkipPreviousRounded';
import { IconButton } from '@mui/material';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import {
  generateMusic,
  getMusicServiceHealth,
  listMusicHistory,
  toPlayableFileUrl,
} from '../../music/musicGenerationApi';
import { createBundledMusicAssets, createGeneratedMusicAsset } from '../../music/musicAssets';
import styles from './MusicRegulation.module.css';

const bundledMusicFiles = [] as const;
const noVocalsConstraint = 'no vocals';
const instrumentOptions = [
  {
    label: 'Piano',
    value: 'piano',
  },
  {
    label: 'Violin',
    value: 'violin',
  },
  {
    label: 'Piano + Violin',
    value: 'piano and violin',
  },
  {
    label: 'Guitar',
    value: 'guitar',
  },
  {
    label: 'Synth Pad',
    value: 'soft synth pad',
  },
  {
    label: 'Custom',
    value: 'custom',
  },
] as const;
const styleOptions = [
  {
    label: 'Ambient',
    value: 'ambient instrumental',
  },
  {
    label: 'Pop',
    value: 'pop instrumental',
  },
  {
    label: 'Rock',
    value: 'rock instrumental',
  },
  {
    label: 'Classical',
    value: 'classical instrumental',
  },
  {
    label: 'Meditation',
    value: 'meditation music',
  },
  {
    label: 'Custom',
    value: 'custom',
  },
] as const;

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function buildPrompt(instrument: string, customInstrument: string, style: string, customStyle: string, details: string) {
  const selectedInstrument = instrument === 'custom' ? customInstrument.trim() : instrument;
  const selectedStyle = style === 'custom' ? customStyle.trim() : style;
  const parts = [selectedInstrument, selectedStyle, details.trim(), noVocalsConstraint]
    .filter((part) => part.length > 0);

  return Array.from(new Set(parts)).join(', ');
}

export default function MusicRegulation() {
  const { currentUser } = useAuth();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bundledAssets = useMemo(() => createBundledMusicAssets(bundledMusicFiles), []);
  const [generatedItems, setGeneratedItems] = useState<Awaited<ReturnType<typeof listMusicHistory>>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStage, setGenerationStage] = useState('Ready');
  const [generationDevice, setGenerationDevice] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [generationDuration, setGenerationDuration] = useState(30);
  const [instrument, setInstrument] = useState('piano');
  const [customInstrument, setCustomInstrument] = useState('');
  const [style, setStyle] = useState('ambient instrumental');
  const [customStyle, setCustomStyle] = useState('');
  const [details, setDetails] = useState('soft strings, calm therapeutic texture');
  const [error, setError] = useState<string | null>(null);
  const generatedAssets = useMemo(
    () => generatedItems.map((item) => createGeneratedMusicAsset(item, toPlayableFileUrl)),
    [generatedItems],
  );
  const assets = useMemo(
    () => [...generatedAssets, ...bundledAssets],
    [bundledAssets, generatedAssets],
  );
  const activeAsset = assets[activeIndex];
  const generatedPrompt = useMemo(
    () => buildPrompt(instrument, customInstrument, style, customStyle, details),
    [customInstrument, customStyle, details, instrument, style],
  );
  const hasPromptCore = (instrument !== 'custom' || customInstrument.trim().length > 0)
    && (style !== 'custom' || customStyle.trim().length > 0);
  const canGenerate = generatedPrompt.trim().length > 0 && hasPromptCore;
  const generationDeviceLabel = generationDevice ? generationDevice.toUpperCase() : 'Detecting device';
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const remainingTime = Math.max(0, duration - currentTime);
  const coverStyle = activeAsset
    ? {
      '--cover-accent': activeAsset.cover.accent,
      '--cover-angle': `${activeAsset.cover.angle}deg`,
      '--cover-primary': activeAsset.cover.primary,
      '--cover-secondary': activeAsset.cover.secondary,
    } as CSSProperties
    : undefined;

  useEffect(() => {
    if (!currentUser) {
      setGeneratedItems([]);
      return;
    }

    let isMounted = true;

    listMusicHistory(currentUser.id)
      .then((items) => {
        if (isMounted) {
          setGeneratedItems(items);
        }
      })
      .catch((reason: unknown) => {
        if (isMounted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      isMounted = false;
    };
  }, [currentUser]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
  }, [activeAsset?.id]);

  useEffect(() => {
    if (activeIndex >= assets.length) {
      setActiveIndex(Math.max(0, assets.length - 1));
    }
  }, [activeIndex, assets.length]);

  useEffect(() => {
    if (!isHistoryOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsHistoryOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHistoryOpen]);

  useEffect(() => {
    if (!isGenerating) {
      return undefined;
    }

    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;

      if (elapsedSeconds < 8) {
        setGenerationStage('Starting service');
        setGenerationProgress(Math.min(28, 8 + elapsedSeconds * 2.5));
      } else if (elapsedSeconds < 40) {
        setGenerationStage('Loading model');
        setGenerationProgress(Math.min(64, 28 + (elapsedSeconds - 8) * 1.1));
      } else {
        setGenerationStage('Generating WAV');
        setGenerationProgress(Math.min(94, 64 + (elapsedSeconds - 40) * 0.6));
      }
    }, 500);

    return () => window.clearInterval(intervalId);
  }, [isGenerating]);

  const playActiveAudio = async () => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    await audio.play();
  };

  const handleTogglePlay = async () => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      await playActiveAudio();
    } else {
      audio.pause();
    }
  };

  const handleTrackChange = async (nextIndex: number) => {
    const audio = audioRef.current;
    const shouldResume = Boolean(audio && !audio.paused);
    if (assets.length === 0) {
      return;
    }

    setActiveIndex((nextIndex + assets.length) % assets.length);

    if (shouldResume) {
      window.setTimeout(() => {
        void playActiveAudio();
      }, 0);
    }
  };

  const handleSeek = (value: number) => {
    const audio = audioRef.current;

    if (!audio || duration <= 0) {
      return;
    }

    audio.currentTime = (value / 100) * duration;
  };

  const handleGenerate = async () => {
    if (!currentUser || isGenerating) {
      return;
    }

    setError(null);
    setIsGenerating(true);
    setGenerationProgress(6);
    setGenerationStage('Starting service');
    setGenerationDevice(null);

    try {
      void getMusicServiceHealth()
        .then((health) => {
          setGenerationDevice(health.device || (health.gpuAvailable ? 'cuda' : 'cpu'));
        })
        .catch(() => {
          setGenerationDevice('unknown');
        });

      const item = await generateMusic({
        duration: generationDuration,
        prompt: generatedPrompt,
        userId: currentUser.id,
      });

      setGeneratedItems((items) => [item, ...items.filter((existing) => existing.id !== item.id)]);
      setActiveIndex(0);
      window.setTimeout(() => {
        void playActiveAudio();
      }, 0);
      setGenerationProgress(100);
      setGenerationStage('Generation complete');
    } catch (reason) {
      setGenerationStage('Generation failed');
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <section className={styles.workspace} aria-label="Music regulation workspace">
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Regulation Player</div>
          <h1 className={styles.title}>WAV Music Generation</h1>
        </div>
        <div className={styles.statusBar}>
          <span className={`${styles.statusPill} ${isPlaying ? styles.playing : styles.idle}`}>
            <GraphicEqRoundedIcon fontSize="small" />
            {isGenerating ? 'Generating' : isPlaying ? 'Playing' : 'Ready'}
          </span>
          <span>{assets.length} WAV tracks</span>
        </div>
      </header>

      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <div className={styles.contentGrid}>
        <form
          className={styles.promptPanel}
          onSubmit={(event) => {
            event.preventDefault();
            void handleGenerate();
          }}
        >
          <div className={styles.promptHeader}>
            <span>Music Generation</span>
            <strong>Prompt Builder</strong>
          </div>

          <div className={styles.layeredFields}>
            <label className={styles.promptField}>
              <span>Layer 1 · Instrument</span>
              <select value={instrument} onChange={(event) => setInstrument(event.currentTarget.value)}>
                {instrumentOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {instrument === 'custom' ? (
              <label className={styles.promptField}>
                <span>Custom instrument</span>
                <input
                  value={customInstrument}
                  maxLength={80}
                  onChange={(event) => setCustomInstrument(event.currentTarget.value)}
                  placeholder="erhu, hang drum, duduk..."
                />
              </label>
            ) : null}

            <label className={styles.promptField}>
              <span>Layer 2 · Style</span>
              <select value={style} onChange={(event) => setStyle(event.currentTarget.value)}>
                {styleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {style === 'custom' ? (
              <label className={styles.promptField}>
                <span>Custom style</span>
                <input
                  value={customStyle}
                  maxLength={80}
                  onChange={(event) => setCustomStyle(event.currentTarget.value)}
                  placeholder="post-rock, lo-fi jazz, cinematic..."
                />
              </label>
            ) : null}

            <label className={styles.promptField}>
              <span>Layer 3 · Details optional</span>
              <textarea
                value={details}
                maxLength={260}
                rows={3}
                onChange={(event) => setDetails(event.currentTarget.value)}
                placeholder="soft rhythm, warm tone, slow tempo..."
              />
            </label>
          </div>

          <div className={styles.promptPreview} title={generatedPrompt}>
            {generatedPrompt || 'Choose an instrument and style to build a prompt.'}
          </div>

          {isGenerating ? (
            <div className={styles.generationProgress} aria-live="polite">
              <div className={styles.generationProgressHeader}>
                <span>{generationStage} - {generationDeviceLabel}</span>
                <strong>{Math.round(generationProgress)}%</strong>
              </div>
              <div className={styles.generationProgressTrack}>
                <span style={{ width: `${generationProgress}%` }} />
              </div>
            </div>
          ) : null}

          <div className={styles.promptActions}>
            <label className={styles.durationField}>
              <span>Length</span>
              <select
                value={generationDuration}
                onChange={(event) => setGenerationDuration(Number(event.currentTarget.value))}
              >
                <option value={15}>15s</option>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
                <option value={120}>120s</option>
              </select>
            </label>

            <button
              className={styles.generateButton}
              type="submit"
              disabled={!currentUser || isGenerating || !canGenerate}
            >
              {isGenerating ? 'Generating WAV' : 'Generate WAV'}
            </button>
          </div>
        </form>

        <div className={styles.lowerGrid}>
          <div className={styles.playbackColumn}>
            <div className={styles.playerCard} style={coverStyle}>
              <button
                className={styles.coverButton}
                type="button"
                aria-label={isPlaying ? 'Pause WAV' : 'Play WAV'}
                onClick={() => {
                  void handleTogglePlay();
                }}
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
                    <strong>{activeAsset?.title || 'No WAV selected'}</strong>
                    <span>{activeAsset?.source === 'generated' ? 'Generated WAV' : 'WAV Stream'}</span>
                  </div>
                  <div className={styles.trackCounter}>
                    {assets.length > 0 ? `${activeIndex + 1}/${assets.length}` : '0/0'}
                  </div>
                </div>

                <div className={styles.timelineRow}>
                  <span>{formatTime(currentTime)}</span>
                  <input
                    className={styles.timeline}
                    type="range"
                    min="0"
                    max="100"
                    value={progress}
                    aria-label="Playback position"
                    style={{ '--progress': `${progress}%` } as CSSProperties}
                    onChange={(event) => handleSeek(Number(event.currentTarget.value))}
                  />
                  <span>-{formatTime(remainingTime)}</span>
                </div>

                <div className={styles.controls}>
                  <div className={styles.transportControls}>
                    <IconButton
                      className={styles.controlButton}
                      aria-label="Previous WAV"
                      disabled={assets.length === 0}
                      onClick={() => {
                        void handleTrackChange(activeIndex - 1);
                      }}
                    >
                      <SkipPreviousRoundedIcon />
                    </IconButton>
                    <IconButton
                      className={`${styles.controlButton} ${styles.primaryButton}`}
                      aria-label={isPlaying ? 'Pause WAV' : 'Play WAV'}
                      disabled={assets.length === 0}
                      onClick={() => {
                        void handleTogglePlay();
                      }}
                    >
                      {isPlaying ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
                    </IconButton>
                    <IconButton
                      className={styles.controlButton}
                      aria-label="Next WAV"
                      disabled={assets.length === 0}
                      onClick={() => {
                        void handleTrackChange(activeIndex + 1);
                      }}
                    >
                      <SkipNextRoundedIcon />
                    </IconButton>
                  </div>

                  <IconButton
                    className={styles.controlButton}
                    aria-label="Open generated WAV history"
                    onClick={() => setIsHistoryOpen(true)}
                  >
                    <QueueMusicRoundedIcon />
                  </IconButton>
                </div>
              </div>
            </div>
          </div>

          <aside className={styles.futurePanel} aria-label="Reserved music workspace">
            Reserved workspace
          </aside>
        </div>
      </div>

      {isHistoryOpen ? (
        <div
          className={styles.historyOverlay}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsHistoryOpen(false);
            }
          }}
        >
          <section className={styles.historyModal} aria-label="Generated WAV history">
            <div className={styles.historyHeader}>
              <div>
                <span>History</span>
                <strong>Generated WAV</strong>
              </div>
              <IconButton
                className={styles.closeButton}
                aria-label="Close history"
                onClick={() => setIsHistoryOpen(false)}
              >
                <CloseRoundedIcon />
              </IconButton>
            </div>
            <div className={styles.queueList}>
              {assets.length === 0 ? (
                <div className={styles.emptyQueue}>Generate a WAV track to start playback.</div>
              ) : assets.map((asset, index) => (
                <button
                  key={asset.id}
                  className={`${styles.queueItem} ${index === activeIndex ? styles.activeQueueItem : ''}`}
                  type="button"
                  onClick={() => {
                    setIsHistoryOpen(false);
                    void handleTrackChange(index);
                  }}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{asset.title}</strong>
                  <em>{asset.source === 'generated' ? 'Generated' : 'Bundled'}</em>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {activeAsset ? (
        <audio
          ref={audioRef}
          src={activeAsset.mediaUrl}
          preload="metadata"
          onDurationChange={(event) => setDuration(event.currentTarget.duration)}
          onEnded={() => {
            void handleTrackChange(activeIndex + 1);
          }}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        />
      ) : null}
    </section>
  );
}
