import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useAuth } from '../../auth/AuthContext';
import {
  MUSIC_GENERATED_EVENT,
  deleteMusicHistoryItem,
  generateMusic,
  getMusicServiceHealth,
} from '../../music/musicGenerationApi';
import type { GeneratedMusicHistoryItem } from '../../music/musicAssets';
import { buildMusicPrompt } from '../../music/musicPrompt';
import {
  getNextOpenTagSelector,
  setCurrentMusicRegulationTags,
} from '../../music/musicRegulationTags';
import { describeFriendlyError } from '../../ui/friendlyError';
import { isTauriAvailable } from '../../ui/tauriEnvironment';
import { MusicHistoryDrawer } from './MusicHistoryDrawer';
import { MusicPlayerCard } from './MusicPlayerCard';
import { MusicPromptForm } from './MusicPromptForm';
import { TagEditorSheet } from './MusicTagEditor';
import {
  type AgentMusicPromptDetail,
  MAX_GENERATED_ITEMS,
  detailTagColors,
  detailTemplateOptions,
  formatTime,
  generationDurationOptions,
  instrumentOptions,
  instrumentTagColors,
  selectTagValues,
  splitPlannerTags,
  styleOptions,
  styleTagColors,
  toggleTagSelection,
} from './musicRegulationOptions';
import { RegulationSessionBanner } from './regulationSessionBanner';
import { useEffectRegulationContext } from './useEffectRegulationContext';
import { useMusicQueue } from './useMusicQueue';
import styles from './MusicRegulation.module.css';

export default function MusicRegulation() {
  const { currentUser } = useAuth();
  // Effect-evaluation session context (R4/F4): while this page hosts a live
  // regulation window, the banner shows the target emotion and remaining
  // time, and the window's zero tick keeps playback stopped.
  const regulationContext = useEffectRegulationContext('music', () => {
    audioRef.current?.pause();
  });
  // Marks the awaited generateMusic call as abandoned so a late resolution or
  // rejection after 「取消等待」 cannot clobber post-cancel state (or autoplay
  // over whatever the user did next). One token per run also keeps a cancelled
  // wait from interfering with a follow-up generation.
  const generationWaitRef = useRef<{ abandoned: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    activeAsset,
    activeIndex,
    assets,
    audioRef,
    handleTogglePlay,
    handleTrackChange,
    isPlaying,
    playActiveAudio,
    setActiveIndex,
    setGeneratedItems,
    setIsPlaying,
  } = useMusicQueue({
    userId: currentUser?.id,
    onLoadError: (reason: unknown) => setError(describeFriendlyError(reason, '加载生成记录')),
    onPlaybackError: (message: string) => setError(message),
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [openTagSelectorId, setOpenTagSelectorId] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [generationDevice, setGenerationDevice] = useState<string | null>(null);
  const [generationDuration, setGenerationDuration] = useState(30);
  const [instruments, setInstruments] = useState<string[]>([]);
  const [customInstrument, setCustomInstrument] = useState('');
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [customStyle, setCustomStyle] = useState('');
  const [detailTemplates, setDetailTemplates] = useState<string[]>([]);
  const [details, setDetails] = useState('');
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const generatedPrompt = useMemo(
    () => buildMusicPrompt(instruments, customInstrument, selectedStyles, customStyle, detailTemplates, details),
    [customInstrument, customStyle, detailTemplates, details, instruments, selectedStyles],
  );
  const currentTagKeywords = useMemo(
    () => [
      ...instruments.filter((instrument) => instrument !== 'custom'),
      customInstrument,
      ...selectedStyles.filter((style) => style !== 'custom'),
      customStyle,
      ...detailTemplates,
      details,
    ],
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
  const generationDeviceLabel = generationDevice ? generationDevice.toUpperCase() : '检测设备中';
  const coverStyle = activeAsset
    ? {
      '--cover-accent': activeAsset.cover.accent,
      '--cover-angle': `${activeAsset.cover.angle}deg`,
      '--cover-primary': activeAsset.cover.primary,
      '--cover-secondary': activeAsset.cover.secondary,
    } as CSSProperties
    : undefined;

  useEffect(() => {
    const handleGeneratedMusic = (event: Event) => {
      const item = (event as CustomEvent<GeneratedMusicHistoryItem>).detail;

      if (!item) {
        return;
      }

      setGeneratedItems((items) => [item, ...items.filter((existing) => existing.id !== item.id)].slice(0, MAX_GENERATED_ITEMS));
      setActiveIndex(0);
    };

    window.addEventListener(MUSIC_GENERATED_EVENT, handleGeneratedMusic);

    return () => window.removeEventListener(MUSIC_GENERATED_EVENT, handleGeneratedMusic);
  }, [setActiveIndex, setGeneratedItems]);

  useEffect(() => {
    const applyAgentMusicPrompt = (event: Event) => {
      const detail = (event as CustomEvent<AgentMusicPromptDetail>).detail;

      if (!detail) {
        return;
      }

      const detailTags = splitPlannerTags(detail.details);
      const detailTemplateValues = new Set<string>(detailTemplateOptions.map((option) => option.value));
      const templateMatches = detailTags.filter((tag) => detailTemplateValues.has(tag));
      const customDetails = detailTags.filter((tag) => !detailTemplateValues.has(tag));

      setInstruments(selectTagValues(instrumentOptions, [detail.instrument], setCustomInstrument));
      setSelectedStyles(selectTagValues(styleOptions, [detail.style], setCustomStyle));
      setDetailTemplates(templateMatches);
      setDetails(customDetails.join(', '));

      if (typeof detail.duration === 'number' && generationDurationOptions.includes(detail.duration as typeof generationDurationOptions[number])) {
        setGenerationDuration(detail.duration);
      }
    };

    window.addEventListener('agent:music-prompt', applyAgentMusicPrompt);

    return () => window.removeEventListener('agent:music-prompt', applyAgentMusicPrompt);
  }, []);

  useEffect(() => {
    setCurrentMusicRegulationTags(currentTagKeywords);
  }, [currentTagKeywords]);

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

  const handleInstrumentToggle = (value: string) => {
    setInstruments((selectedInstruments) => toggleTagSelection(selectedInstruments, value));
  };

  const handleStyleToggle = (value: string) => {
    setSelectedStyles((styles) => toggleTagSelection(styles, value));
  };

  const handleDetailTemplateToggle = (value: string) => {
    setDetailTemplates((templates) => toggleTagSelection(templates, value));
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
      title: '乐器',
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
        title: '风格',
      }
      : openTagSelectorId === 'details'
        ? {
          colors: detailTagColors,
          onOnly: handleDetailTemplateOnly,
          onToggle: handleDetailTemplateToggle,
          options: detailTemplateOptions,
          selectedValues: detailTemplates,
          title: '细节',
        }
        : null;

  // The service has no cancel endpoint, so this only gives up waiting: the
  // invoke keeps running and its track still arrives in history via
  // MUSIC_GENERATED_EVENT once the background job finishes.
  const handleCancelGeneration = () => {
    const waitState = generationWaitRef.current;

    if (waitState) {
      waitState.abandoned = true;
    }

    setIsGenerating(false);
    setGenerationNotice('已取消等待，后台可能仍在生成；完成后曲目会出现在「生成记录」中。');
  };

  const handleGenerate = async () => {
    if (!currentUser || isGenerating) {
      return;
    }

    setError(null);
    setGenerationNotice(null);
    setIsGenerating(true);
    setGenerationDevice(null);
    const waitState = { abandoned: false };
    generationWaitRef.current = waitState;
    const generationStartedAt = Date.now();

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

      if (waitState.abandoned) {
        // The MUSIC_GENERATED_EVENT listener already filed the finished track
        // into history; skip the notice and autoplay of an abandoned wait.
        return;
      }

      setGeneratedItems((items) => [item, ...items.filter((existing) => existing.id !== item.id)].slice(0, MAX_GENERATED_ITEMS));
      setActiveIndex(0);
      setGenerationNotice(`生成完成,耗时 ${formatTime((Date.now() - generationStartedAt) / 1000)}。`);
      window.setTimeout(() => {
        void playActiveAudio();
      }, 0);
    } catch (reason) {
      if (waitState.abandoned) {
        console.error('[ui] 已取消等待的后台音乐生成失败:', reason);
      } else {
        setError(describeFriendlyError(reason, '生成 WAV'));
      }
    } finally {
      // Only the currently awaited run may touch shared wait state; a late
      // finishing run after cancel + regenerate must leave the new one alone.
      if (generationWaitRef.current === waitState) {
        generationWaitRef.current = null;
        setIsGenerating(false);
      }
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
      setError(describeFriendlyError(reason, '删除曲目'));
    } finally {
      setDeletingItemId(null);
    }
  };

  return (
    <section className={`${styles.workspace} mx-auto flex w-full flex-col`} aria-label="音乐调控工作区">
      <header className={`${styles.header} flex items-start justify-between`}>
        <div>
          <div className={styles.eyebrow}>音乐调控播放器</div>
          <h1 className={styles.title}>WAV 音乐生成</h1>
        </div>
        <div className={`${styles.statusBar} flex flex-wrap items-center justify-end`}>
          <span className={`${styles.statusPill} inline-flex items-center ${isPlaying ? styles.playing : styles.idle}`}>
            <GraphicEqRoundedIcon fontSize="small" />
            {isGenerating ? '生成中' : isPlaying ? '播放中' : '就绪'}
          </span>
          <span>{assets.length} 首 WAV</span>
        </div>
      </header>

      <RegulationSessionBanner context={regulationContext} className={styles.effectSessionBanner} />

      {error ? (
        isTauriAvailable() ? (
          <div className={styles.errorBanner} role="alert">{error}</div>
        ) : (
          // Browser preview: generation and history live behind Tauri commands,
          // so the failure is the environment — degrade to a calm notice.
          <div className={styles.environmentNotice} role="status">
            当前为浏览器预览,音乐生成与生成记录需在桌面应用中使用。
          </div>
        )
      ) : null}
      {!error && generationNotice ? <div className={styles.successBanner} role="status">{generationNotice}</div> : null}

      <div className={`${styles.contentGrid} grid`}>
        <MusicPromptForm
          generatedPrompt={generatedPrompt}
          instruments={instruments}
          customInstrument={customInstrument}
          selectedStyles={selectedStyles}
          customStyle={customStyle}
          detailTemplates={detailTemplates}
          details={details}
          openTagSelectorId={openTagSelectorId}
          onTagSelectorOpenChange={handleTagSelectorOpenChange}
          onDetailsChange={setDetails}
          isGenerating={isGenerating}
          generationDeviceLabel={generationDeviceLabel}
          onCancel={handleCancelGeneration}
          generationDuration={generationDuration}
          onDurationChange={setGenerationDuration}
          isSignedIn={Boolean(currentUser)}
          canGenerate={canGenerate}
          onSubmit={() => {
            void handleGenerate();
          }}
        />

        <div className={`${styles.lowerGrid} grid items-start`}>
          <div className="min-w-0">
            <MusicPlayerCard
              activeAsset={activeAsset}
              assetCount={assets.length}
              activeIndex={activeIndex}
              isPlaying={isPlaying}
              audioRef={audioRef}
              coverStyle={coverStyle}
              onTogglePlay={() => {
                void handleTogglePlay();
              }}
              onTrackChange={(nextIndex) => {
                void handleTrackChange(nextIndex);
              }}
              onOpenHistory={() => setIsHistoryOpen(true)}
            />
          </div>
        </div>
      </div>

      {isHistoryOpen ? (
        <MusicHistoryDrawer
          assets={assets}
          activeIndex={activeIndex}
          deletingItemId={deletingItemId}
          onClose={() => setIsHistoryOpen(false)}
          onSelectTrack={(index) => {
            setIsHistoryOpen(false);
            void handleTrackChange(index);
          }}
          onDeleteItem={(itemId, index) => {
            void handleDeleteHistoryItem(itemId, index);
          }}
        />
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
          preload="auto"
          onEnded={() => {
            void handleTrackChange(activeIndex + 1);
          }}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          onError={() => setError('音频加载失败，请重新生成或选择其他曲目。')}
        />
      ) : null}
    </section>
  );
}
