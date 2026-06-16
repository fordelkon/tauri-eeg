import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
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
  deleteMusicHistoryItem,
  generateMusic,
  getMusicServiceHealth,
  listMusicHistory,
  toPlayableFileUrl,
} from '../../music/musicGenerationApi';
import { createBundledMusicAssets, createGeneratedMusicAsset } from '../../music/musicAssets';
import { buildMusicPrompt } from '../../music/musicPrompt';
import {
  getCompactTagSummary,
  getNextOpenTagSelector,
  type CompactTagOption,
} from '../../music/musicRegulationTags';
import styles from './MusicRegulation.module.css';

const bundledMusicFiles = [] as const;
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
    label: 'Guitar',
    value: 'guitar',
  },
  {
    label: 'Cello',
    value: 'cello',
  },
  {
    label: 'Flute',
    value: 'flute',
  },
  {
    label: 'Drums',
    value: 'drums',
  },
  {
    label: 'Bass',
    value: 'bass',
  },
  {
    label: 'Synth',
    value: 'synthesizer',
  },
  {
    label: 'Saxophone',
    value: 'saxophone',
  },
  {
    label: 'Other',
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
    label: 'Lo-fi',
    value: 'lo-fi instrumental',
  },
  {
    label: 'Jazz',
    value: 'jazz instrumental',
  },
  {
    label: 'Cinematic',
    value: 'cinematic instrumental',
  },
  {
    label: 'Other',
    value: 'custom',
  },
] as const;
const detailTemplateOptions = [
  {
    label: 'Slow tempo',
    value: 'slow tempo',
  },
  {
    label: 'Warm tone',
    value: 'warm tone',
  },
  {
    label: 'Soft rhythm',
    value: 'soft rhythm',
  },
  {
    label: 'Calm texture',
    value: 'calm therapeutic texture',
  },
  {
    label: 'Light reverb',
    value: 'light reverb',
  },
  {
    label: 'Gentle dynamics',
    value: 'gentle dynamics',
  },
  {
    label: 'Deep bass',
    value: 'deep bass',
  },
  {
    label: 'Bright melody',
    value: 'bright melody',
  },
] as const;
const instrumentTagColors = ['#6adfbb', '#ef6f61', '#f8a62b', '#5d8fe8', '#a78bfa', '#e26ca5', '#4fb2c6', '#8cc35f', '#d7a86e', '#9aa2a9'] as const;
const styleTagColors = ['#6adfbb', '#ef6f61', '#f8a62b', '#5d8fe8', '#a78bfa', '#e26ca5', '#4fb2c6', '#8cc35f', '#d7a86e'] as const;
const detailTagColors = ['#6adfbb', '#ef6f61', '#f8a62b', '#5d8fe8', '#a78bfa', '#e26ca5', '#4fb2c6', '#8cc35f'] as const;

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

type CompactTagSelectorProps = {
  id: string;
  label: string;
  options: readonly CompactTagOption[];
  isOpen: boolean;
  selectedValues: string[];
  colors: readonly string[];
  customValue?: string;
  onOpenChange: (id: string) => void;
};

function CompactTagSelector({
  id,
  label,
  options,
  isOpen,
  selectedValues,
  colors,
  customValue,
  onOpenChange,
}: CompactTagSelectorProps) {
  const summary = getCompactTagSummary(
    options,
    selectedValues,
    customValue ? { custom: customValue } : undefined,
  );

  return (
    <div className={styles.tagSelector}>
      <button
        className={styles.tagTrigger}
        type="button"
        aria-expanded={isOpen}
        onClick={() => onOpenChange(id)}
      >
        <span className={styles.tagDotStack} aria-hidden="true">
          {options.map((option, index) => (
            <span
              key={option.value}
              className={selectedValues.includes(option.value) ? styles.activeTagDot : ''}
              style={{ '--tag-color': colors[index % colors.length] } as CSSProperties}
            />
          ))}
        </span>
        <span className={styles.tagTriggerText}>{label}</span>
        <span className={styles.tagCount}>{summary.countLabel}</span>
        <span className={`${styles.tagChevron} ${isOpen ? styles.tagChevronOpen : ''}`} aria-hidden="true" />
      </button>
    </div>
  );
}

type TagEditorSheetProps = {
  title: string;
  options: readonly CompactTagOption[];
  selectedValues: string[];
  colors: readonly string[];
  customPlaceholder?: string;
  customValue?: string;
  onClose: () => void;
  onCustomChange?: (value: string) => void;
  onOnly: (value: string) => void;
  onToggle: (value: string) => void;
};

function TagEditorSheet({
  title,
  options,
  selectedValues,
  colors,
  customPlaceholder,
  customValue,
  onClose,
  onCustomChange,
  onOnly,
  onToggle,
}: TagEditorSheetProps) {
  const summary = getCompactTagSummary(
    options,
    selectedValues,
    customValue ? { custom: customValue } : undefined,
  );

  return (
    <div className={`${styles.tagSheetOverlay} fixed inset-0 z-20 flex`} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <section className={styles.tagSheet} aria-label={`${title} tags`}>
        <div className={styles.tagSheetHeader}>
          <div>
            <span>{title}</span>
            <strong>{summary.label}</strong>
          </div>
          <button className={styles.tagSheetClose} type="button" aria-label="Close tag editor" onClick={onClose}>
            <CloseRoundedIcon fontSize="small" />
          </button>
        </div>

        <div className={styles.tagSheetList}>
          {options.map((option, index) => {
            const isSelected = selectedValues.includes(option.value);

            return (
              <div key={option.value} className={styles.tagMenuItem}>
                <label className={styles.tagMenuToggle}>
                  <input
                    checked={isSelected}
                    type="checkbox"
                    value={option.value}
                    onChange={() => onToggle(option.value)}
                  />
                  <span className={styles.tagCheck} aria-hidden="true" />
                  <span
                    className={`${styles.tagOptionDot} ${isSelected ? styles.activeTagOptionDot : ''}`}
                    style={{ '--tag-color': colors[index % colors.length] } as CSSProperties}
                    aria-hidden="true"
                  />
                  <span className={styles.tagOptionLabel}>{option.label}</span>
                </label>
                <button
                  className={styles.tagOnlyButton}
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    onOnly(option.value);
                  }}
                >
                  Only
                </button>
                {option.value === 'custom' && isSelected ? (
                  <input
                    className={styles.tagCustomInput}
                    value={customValue || ''}
                    maxLength={80}
                    onChange={(event) => onCustomChange?.(event.currentTarget.value)}
                    placeholder={customPlaceholder}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
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
  const [openTagSelectorId, setOpenTagSelectorId] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStage, setGenerationStage] = useState('Ready');
  const [generationDevice, setGenerationDevice] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [generationDuration, setGenerationDuration] = useState(30);
  const [instruments, setInstruments] = useState<string[]>(['piano']);
  const [customInstrument, setCustomInstrument] = useState('');
  const [selectedStyles, setSelectedStyles] = useState<string[]>(['ambient instrumental']);
  const [customStyle, setCustomStyle] = useState('');
  const [detailTemplates, setDetailTemplates] = useState<string[]>(['calm therapeutic texture']);
  const [details, setDetails] = useState('soft strings');
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
    () => buildMusicPrompt(instruments, customInstrument, selectedStyles, customStyle, detailTemplates, details),
    [customInstrument, customStyle, detailTemplates, details, instruments, selectedStyles],
  );
  const hasSelectedInstrument = instruments.some((selectedInstrument) => (
    selectedInstrument === 'custom' ? customInstrument.trim().length > 0 : true
  ));
  const hasSelectedStyle = selectedStyles.some((selectedStyle) => (
    selectedStyle === 'custom' ? customStyle.trim().length > 0 : true
  ));
  const hasPromptCore = hasSelectedInstrument
    && hasSelectedStyle;
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

  const handleInstrumentToggle = (value: string) => {
    setInstruments((selectedInstruments) => {
      if (selectedInstruments.includes(value)) {
        return selectedInstruments.filter((instrumentValue) => instrumentValue !== value);
      }

      return [...selectedInstruments, value];
    });
  };

  const handleStyleToggle = (value: string) => {
    setSelectedStyles((styles) => {
      if (styles.includes(value)) {
        return styles.filter((styleValue) => styleValue !== value);
      }

      return [...styles, value];
    });
  };

  const handleDetailTemplateToggle = (value: string) => {
    setDetailTemplates((templates) => {
      if (templates.includes(value)) {
        return templates.filter((templateValue) => templateValue !== value);
      }

      return [...templates, value];
    });
  };
  const handleInstrumentOnly = (value: string) => setInstruments([value]);
  const handleStyleOnly = (value: string) => setSelectedStyles([value]);
  const handleDetailTemplateOnly = (value: string) => setDetailTemplates([value]);
  const handleTagSelectorOpenChange = (id: string) => {
    setOpenTagSelectorId((currentId) => getNextOpenTagSelector(currentId, id));
  };
  const openTagEditor = openTagSelectorId === 'instrument'
    ? {
      colors: instrumentTagColors,
      customPlaceholder: 'erhu, hang drum, duduk...',
      customValue: customInstrument,
      onCustomChange: setCustomInstrument,
      onOnly: handleInstrumentOnly,
      onToggle: handleInstrumentToggle,
      options: instrumentOptions,
      selectedValues: instruments,
      title: 'Instrument',
    }
    : openTagSelectorId === 'style'
      ? {
        colors: styleTagColors,
        customPlaceholder: 'post-rock, lo-fi jazz, cinematic...',
        customValue: customStyle,
        onCustomChange: setCustomStyle,
        onOnly: handleStyleOnly,
        onToggle: handleStyleToggle,
        options: styleOptions,
        selectedValues: selectedStyles,
        title: 'Style',
      }
      : openTagSelectorId === 'details'
        ? {
          colors: detailTagColors,
          onOnly: handleDetailTemplateOnly,
          onToggle: handleDetailTemplateToggle,
          options: detailTemplateOptions,
          selectedValues: detailTemplates,
          title: 'Details',
        }
        : null;

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
        username: currentUser.username,
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

  const handleDeleteHistoryItem = async (itemId: string, index: number) => {
    if (!currentUser || deletingItemId) {
      return;
    }

    const audio = audioRef.current;
    const deletingActiveAsset = index === activeIndex;

    if (deletingActiveAsset) {
      audio?.pause();
    }

    setError(null);
    setDeletingItemId(itemId);

    try {
      await deleteMusicHistoryItem(currentUser.id, itemId);
      setGeneratedItems((items) => items.filter((item) => item.id !== itemId));
      setActiveIndex((currentIndex) => {
        if (index < currentIndex) {
          return currentIndex - 1;
        }

        if (index === currentIndex) {
          return Math.max(0, currentIndex - 1);
        }

        return currentIndex;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeletingItemId(null);
    }
  };

  return (
    <section className={`${styles.workspace} mx-auto flex w-full flex-col`} aria-label="Music regulation workspace">
      <header className={`${styles.header} flex items-start justify-between`}>
        <div>
          <div className={styles.eyebrow}>Regulation Player</div>
          <h1 className={styles.title}>WAV Music Generation</h1>
        </div>
        <div className={`${styles.statusBar} flex flex-wrap items-center justify-end`}>
          <span className={`${styles.statusPill} inline-flex items-center ${isPlaying ? styles.playing : styles.idle}`}>
            <GraphicEqRoundedIcon fontSize="small" />
            {isGenerating ? 'Generating' : isPlaying ? 'Playing' : 'Ready'}
          </span>
          <span>{assets.length} WAV tracks</span>
        </div>
      </header>

      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <div className={`${styles.contentGrid} grid`}>
        <form
          className={`${styles.promptPanel} flex w-full min-w-0 flex-col`}
          onSubmit={(event) => {
            event.preventDefault();
            void handleGenerate();
          }}
        >
          <div className={`${styles.promptHeader} flex flex-col`}>
            <span>Music Generation</span>
            <strong>Prompt Builder</strong>
          </div>

          <div className={`${styles.layeredFields} grid`}>
            <div className={`${styles.promptField} flex min-w-0 flex-col`}>
              <span>Layer 1 · Instrument</span>
              <CompactTagSelector
                id="instrument"
                label="Instrument"
                options={instrumentOptions}
                isOpen={openTagSelectorId === 'instrument'}
                selectedValues={instruments}
                colors={instrumentTagColors}
                customValue={customInstrument}
                onOpenChange={handleTagSelectorOpenChange}
              />
            </div>

            <div className={`${styles.promptField} flex min-w-0 flex-col`}>
              <span>Layer 2 · Style</span>
              <CompactTagSelector
                id="style"
                label="Style"
                options={styleOptions}
                isOpen={openTagSelectorId === 'style'}
                selectedValues={selectedStyles}
                colors={styleTagColors}
                customValue={customStyle}
                onOpenChange={handleTagSelectorOpenChange}
              />
            </div>

            <div className={`${styles.promptField} flex min-w-0 flex-col`}>
              <span>Layer 3 · Details optional</span>
              <CompactTagSelector
                id="details"
                label="Details"
                options={detailTemplateOptions}
                isOpen={openTagSelectorId === 'details'}
                selectedValues={detailTemplates}
                colors={detailTagColors}
                onOpenChange={handleTagSelectorOpenChange}
              />
              <textarea
                value={details}
                maxLength={260}
                rows={3}
                onChange={(event) => setDetails(event.currentTarget.value)}
                placeholder="soft rhythm, warm tone, slow tempo..."
              />
            </div>
          </div>

          <div className={styles.promptPreview} title={generatedPrompt}>
            {generatedPrompt || 'Choose an instrument and style to build a prompt.'}
          </div>

          {isGenerating ? (
            <div className={`${styles.generationProgress} grid`} aria-live="polite">
              <div className={`${styles.generationProgressHeader} flex items-center justify-between`}>
                <span>{generationStage} - {generationDeviceLabel}</span>
                <strong>{Math.round(generationProgress)}%</strong>
              </div>
              <div className={styles.generationProgressTrack}>
                <span style={{ width: `${generationProgress}%` }} />
              </div>
            </div>
          ) : null}

          <div className={`${styles.promptActions} grid items-end`}>
            <label className={`${styles.durationField} flex min-w-0 flex-col`}>
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

        <div className={`${styles.lowerGrid} grid items-start`}>
          <div className="min-w-0">
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
        </div>
      </div>

      {isHistoryOpen ? (
        <div
          className={`${styles.historyOverlay} fixed inset-0 z-20 flex items-center`}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsHistoryOpen(false);
            }
          }}
        >
          <section className={`${styles.historyModal} flex min-h-0 w-full flex-col`} aria-label="Generated WAV history">
            <div className={`${styles.historyHeader} flex items-center justify-between`}>
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
            <div className={`${styles.queueList} grid min-h-0 overflow-auto`}>
              {assets.length === 0 ? (
                <div className={styles.emptyQueue}>Generate a WAV track to start playback.</div>
              ) : assets.map((asset, index) => (
                <div
                  key={asset.id}
                  className={`${styles.queueItem} grid items-center ${index === activeIndex ? styles.activeQueueItem : ''}`}
                >
                  <button
                    className={`${styles.queueSelectButton} grid min-w-0 items-center border-0 bg-transparent text-left`}
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
                  {asset.source === 'generated' ? (
                    <IconButton
                      className={styles.deleteQueueButton}
                      aria-label={`Delete ${asset.title}`}
                      disabled={deletingItemId === asset.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteHistoryItem(asset.id, index);
                      }}
                    >
                      <DeleteOutlineRoundedIcon />
                    </IconButton>
                  ) : (
                    <span className={styles.queueSpacer} aria-hidden="true" />
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {openTagEditor ? (
        <TagEditorSheet
          title={openTagEditor.title}
          options={openTagEditor.options}
          selectedValues={openTagEditor.selectedValues}
          colors={openTagEditor.colors}
          customValue={openTagEditor.customValue}
          customPlaceholder={openTagEditor.customPlaceholder}
          onToggle={openTagEditor.onToggle}
          onOnly={openTagEditor.onOnly}
          onCustomChange={openTagEditor.onCustomChange}
          onClose={() => setOpenTagSelectorId(null)}
        />
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
