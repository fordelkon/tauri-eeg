import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import SlideshowRoundedIcon from '@mui/icons-material/SlideshowRounded';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { chooseVideoLibraryFolder } from '../../video/videoDirectoryPicker';
import type { VideoLibrary } from '../../video/videoLibraryApi';
import { loadVideoLibrary } from '../../video/videoLibraryApi';
import {
  readStoredLibraryRootPath,
  writeStoredLibraryRootPath,
} from '../../video/videoLibraryStorage';
import {
  getDefaultVideoSelections,
  getAllVideoRegulationAssets,
  getNextVideoSelectionStep,
  getVideoRegulationCatalog,
  getVideoSelectionOptions,
  selectFirstMatchedVideo,
  type VideoRegulationAsset,
  type VideoRegulationSelections,
  type VideoSelectionStep,
  videoLibraryPath,
  videoSelectionStepLabels,
  videoSelectionSteps,
} from '../../video/videoRegulationCatalog';
import { describeFriendlyError } from '../../ui/friendlyError';
import { isTauriAvailable } from '../../ui/tauriEnvironment';
import { RegulationSessionBanner } from './regulationSessionBanner';
import { TagGroup } from './VideoTagSelector';
import { VideoRegulationPlayerModal } from './VideoRegulationPlayerModal';
import { usePauseMediaOnChange } from './useRegulationMedia';
import { useEffectRegulationContext } from './useEffectRegulationContext';
import styles from './VideoRegulation.module.css';

const tagColors = ['#48a868', '#e16d4f', '#e3a22c', '#4d7fc8', '#9c6ade'] as const;

// Deterministic per-card hue: the video's first tag picks a color from the
// tag palette (stable hash, not list position) so neighbouring candidate
// cards visually differ without new design tokens.
function firstTagHue(video: VideoRegulationAsset): string {
  const firstTag = video.tags[0] ?? video.segment.scene ?? '';
  let hash = 0;
  for (let index = 0; index < firstTag.length; index += 1) {
    hash = (hash * 31 + firstTag.charCodeAt(index)) >>> 0;
  }
  return tagColors[hash % tagColors.length];
}

function getVisibleTags(video: VideoRegulationAsset) {
  return [
    video.segment.scene,
    video.segment.atmosphere,
    ...video.tags,
  ].slice(0, 9);
}

function clearFollowingSelections(selections: VideoRegulationSelections, step: VideoSelectionStep) {
  const nextSelections = { ...selections };
  const selectedIndex = videoSelectionSteps.indexOf(step);

  videoSelectionSteps.slice(selectedIndex + 1).forEach((nextStep) => {
    nextSelections[nextStep] = '';
  });

  return nextSelections;
}

export default function VideoRegulation() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [selections, setSelections] = useState<VideoRegulationSelections>(() => getDefaultVideoSelections());
  const [activeVideo, setActiveVideo] = useState<VideoRegulationAsset | null>(null);
  // Effect-evaluation session context (R4/F4): while this page hosts a live
  // regulation window, the banner shows the target emotion and remaining
  // time; at zero the player closes so playback stays stopped.
  const regulationContext = useEffectRegulationContext('video', () => {
    videoRef.current?.pause();
    setActiveVideo(null);
  });
  const [videoLibrary, setVideoLibrary] = useState<VideoLibrary | null>(null);
  const [libraryError, setLibraryError] = useState('');
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const libraryAssets = videoLibrary?.assets;
  const videos = useMemo(() => getVideoRegulationCatalog(selections, libraryAssets), [libraryAssets, selections]);
  const currentStep = getNextVideoSelectionStep(selections);
  const hasStartedSelection = videoSelectionSteps.some((step) => selections[step].trim().length > 0);
  const currentOptions = useMemo(
    () => (currentStep ? getVideoSelectionOptions(selections, currentStep, libraryAssets) : []),
    [currentStep, libraryAssets, selections],
  );
  const isPlaying = activeVideo !== null;
  const libraryRoot = videoLibrary?.root ?? videoLibraryPath;

  // Restore the last loaded library root on mount (same best-effort memory as
  // the paradigm setup panel). A directory that has gone missing or no longer
  // yields assets silently degrades to the default library.
  useEffect(() => {
    const storedRootPath = readStoredLibraryRootPath();
    if (!storedRootPath) {
      return undefined;
    }

    let disposed = false;

    loadVideoLibrary(storedRootPath)
      .then((restored) => {
        if (disposed) {
          return;
        }

        if (restored.assets.length > 0) {
          // Keep whichever library is already present (e.g. one the operator
          // just picked while the restore was in flight).
          setVideoLibrary((current) => current ?? restored);
        } else {
          writeStoredLibraryRootPath('');
        }
      })
      .catch(() => {
        // Directory unavailable (unplugged drive etc.); stay on the default.
      });

    return () => {
      disposed = true;
    };
  }, []);

  // Pause the playing video whenever it is closed, switched to another asset, or
  // the page unmounts; a removed <video> element would otherwise keep decoding.
  usePauseMediaOnChange(videoRef, activeVideo?.id);

  useEffect(() => {
    if (!activeVideo) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveVideo(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeVideo]);

  useEffect(() => {
    const handleAgentPlayVideo = (event: Event) => {
      const videoId = (event as CustomEvent<{ videoId?: string | null }>).detail?.videoId;
      const video = getAllVideoRegulationAssets(libraryAssets).find((candidate) => candidate.id === videoId) ?? null;

      if (video) {
        setActiveVideo(video);
      }
    };

    window.addEventListener('agent:play-video', handleAgentPlayVideo);

    return () => window.removeEventListener('agent:play-video', handleAgentPlayVideo);
  }, [libraryAssets]);

  const resetSelections = () => {
    setSelections(getDefaultVideoSelections());
    setActiveVideo(null);
  };

  const updateSelection = (step: VideoSelectionStep, value: string) => {
    setSelections((currentSelections) => {
      const nextSelections = {
        ...clearFollowingSelections(currentSelections, step),
        [step]: value,
      };

      if (getNextVideoSelectionStep(nextSelections) === null) {
        setActiveVideo(selectFirstMatchedVideo(nextSelections, libraryAssets));
      }

      return nextSelections;
    });
  };

  const chooseLibraryFolder = async () => {
    setLoadingLibrary(true);
    setLibraryError('');

    try {
      const selectedLibrary = await chooseVideoLibraryFolder();
      if (selectedLibrary) {
        setVideoLibrary(selectedLibrary);
        // Only loaded roots are remembered so the next launch restores a
        // usable library.
        writeStoredLibraryRootPath(selectedLibrary.root);
        setSelections(getDefaultVideoSelections());
        setActiveVideo(null);
      }
    } catch (error) {
      setLibraryError(describeFriendlyError(error, '加载视频库'));
    } finally {
      setLoadingLibrary(false);
    }
  };

  return (
    <section className={`${styles.workspace} mx-auto flex w-full flex-col`} aria-label="视频调控工作区">
      <header className={`${styles.header} flex items-start justify-between`}>
        <div>
          <div className={styles.eyebrow}>视频调节刺激</div>
          <h1 className={styles.title}>视频调控</h1>
          <p className={styles.description}>
            按视频库现有标签逐层选择：标签、氛围、场景。完成后自动弹出一个匹配视频。
          </p>
        </div>
        <div className={`${styles.statusBar} flex flex-wrap items-center justify-end`}>
          <span className={`${styles.statusPill} inline-flex items-center ${isPlaying ? styles.playing : styles.idle}`}>
            <SlideshowRoundedIcon fontSize="small" />
            {isPlaying ? '播放中' : '就绪'}
          </span>
          <span>{hasStartedSelection ? `${videos.length} 个候选视频` : '等待选择'}</span>
          <button
            className={`${styles.libraryButton} ${loadingLibrary ? styles.isBusy : ''}`}
            type="button"
            onClick={chooseLibraryFolder}
            disabled={loadingLibrary}
          >
            {loadingLibrary ? '加载中' : '选择视频库'}
          </button>
        </div>
      </header>

      <RegulationSessionBanner context={regulationContext} className={styles.effectSessionBanner} />

      <div className={`${styles.libraryNotice} grid`}>
        <span>{videoLibrary ? '当前视频库' : '默认视频库'}</span>
        <code>{libraryRoot}</code>
        {libraryError ? (
          isTauriAvailable() ? (
            <strong role="alert">{libraryError}</strong>
          ) : (
            // Browser preview: the library picker and directory scan are Tauri
            // commands, so the failure is the environment — calm info instead
            // of an alarm.
            <span className={styles.libraryEnvironmentNotice} role="status">
              当前为浏览器预览,本地视频库选择需在桌面应用中使用。
            </span>
          )
        ) : null}
      </div>

      <div className={`${styles.contentGrid} ${hasStartedSelection ? styles.withResults : ''} grid`}>
        <main className={`${styles.selectorPanel} grid`} aria-label="视频标签选择器">
          <div className={`${styles.panelHeader} grid`}>
            <span>逐层选择</span>
            <strong>{currentStep ? videoSelectionStepLabels[currentStep] : '已完成选择'}</strong>
          </div>

          <div className={`${styles.selectionTrail} grid`}>
            {videoSelectionSteps.map((step) => (
              <button
                key={step}
                className={`${styles.trailButton} ${selections[step] ? styles.activeTrailButton : ''}`}
                type="button"
                onClick={() => {
                  if (selections[step]) {
                    setSelections((currentSelections) => clearFollowingSelections({ ...currentSelections, [step]: '' }, step));
                  }
                }}
              >
                <span>{videoSelectionStepLabels[step]}</span>
                <strong>{selections[step] || '待选择'}</strong>
              </button>
            ))}
          </div>

          {currentStep ? (
            <TagGroup
              label={videoSelectionStepLabels[currentStep]}
              options={currentOptions}
              selectedValue={selections[currentStep]}
              colors={tagColors}
              onSelect={(value) => updateSelection(currentStep, value)}
            />
          ) : (
            <div className={styles.emptyState}>已匹配到视频，可重新选择或关闭播放器后继续。</div>
          )}

          <button className={styles.resetButton} type="button" onClick={resetSelections}>
            重新选择
          </button>
        </main>

        <aside className={`${styles.libraryPanel} grid`} aria-label="筛选后的视频库">
          <div className={`${styles.panelHeader} grid`}>
            <span>{hasStartedSelection ? '当前候选' : '选择后推荐'}</span>
            <strong>{hasStartedSelection ? `${videos.length} 个匹配` : '完成标签后自动播放'}</strong>
          </div>

          {hasStartedSelection ? (
            <div className={`${styles.videoList} grid`}>
              {videos.length > 0 ? (
              videos.map((video) => (
                <article key={video.id} className={`${styles.videoCard} grid`}>
                  <div
                    className={`${styles.thumbnail} grid place-items-center`}
                    style={{ '--thumb-accent': firstTagHue(video) } as CSSProperties}
                    aria-hidden="true"
                  >
                    <PlayArrowRoundedIcon />
                    <span className={styles.thumbnailDuration}>{video.durationLabel}</span>
                  </div>
                  <div className={`${styles.videoMeta} grid min-w-0`}>
                    <h2>{video.title}</h2>
                    <p>{video.summary}</p>
                    <div className={`${styles.tagChipList} flex flex-wrap`}>
                      {getVisibleTags(video).map((tag) => (
                        <span key={tag} className={styles.tagChip}>{tag}</span>
                      ))}
                    </div>
                    <code>{video.sourcePath}</code>
                  </div>
                  <button
                    className={styles.startButton}
                    type="button"
                    data-agent-action="play_video"
                    data-agent-payload={video.id}
                    onClick={() => setActiveVideo(video)}
                  >
                    播放
                  </button>
                </article>
              ))
              ) : (
                <div className={styles.emptyState}>暂无匹配视频，请返回上一层重新选择。</div>
              )}
            </div>
          ) : (
            <div className={`${styles.previewState} grid`}>
              <PlayArrowRoundedIcon />
              <strong>选择标签后弹出视频</strong>
              <span>{libraryRoot}</span>
            </div>
          )}
        </aside>
      </div>

      {activeVideo ? (
        <VideoRegulationPlayerModal
          activeVideo={activeVideo}
          videoRef={videoRef}
          onClose={() => setActiveVideo(null)}
        />
      ) : null}
    </section>
  );
}
