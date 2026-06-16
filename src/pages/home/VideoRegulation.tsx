import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import SlideshowRoundedIcon from '@mui/icons-material/SlideshowRounded';
import { convertFileSrc } from '@tauri-apps/api/core';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { chooseVideoLibraryFolder } from '../../video/videoDirectoryPicker';
import type { VideoLibrary } from '../../video/videoLibraryApi';
import {
  getDefaultVideoSelections,
  getNextVideoSelectionStep,
  getVideoRegulationCatalog,
  getVideoSelectionOptions,
  selectFirstMatchedVideo,
  toPlayableVideoUrl,
  type VideoRegulationAsset,
  type VideoRegulationSelections,
  type VideoSelectionStep,
  videoLibraryPath,
  videoSelectionStepLabels,
  videoSelectionSteps,
} from '../../video/videoRegulationCatalog';
import type { CompactTagOption } from '../../music/musicRegulationTags';
import playerStyles from './VideoRegulationPlayer.module.css';
import styles from './VideoRegulation.module.css';

const tagColors = ['#48a868', '#e16d4f', '#e3a22c', '#4d7fc8', '#9c6ade'] as const;

type TagGroupProps = {
  colors: readonly string[];
  label: string;
  options: readonly CompactTagOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
};

function TagGroup({ colors, label, options, selectedValue, onSelect }: TagGroupProps) {
  return (
    <section className={`${styles.tagGroup} grid`} aria-label={label}>
      <div className={`${styles.tagGroupHeader} flex items-center justify-between`}>
        <span>{label}</span>
        <strong>{options.length} 项</strong>
      </div>
      <div className={`${styles.tagList} flex flex-wrap`}>
        {options.map((option, index) => {
          const selected = selectedValue === option.value;

          return (
            <button
              key={option.value}
              className={`${styles.tagButton} ${selected ? styles.activeTagButton : ''}`}
              style={{ '--tag-color': colors[index % colors.length] } as CSSProperties}
              type="button"
              onClick={() => onSelect(option.value)}
            >
              <span aria-hidden="true" />
              {option.label}
            </button>
          );
        })}
      </div>
    </section>
  );
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
  const [selections, setSelections] = useState<VideoRegulationSelections>(() => getDefaultVideoSelections());
  const [activeVideo, setActiveVideo] = useState<VideoRegulationAsset | null>(null);
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
        setSelections(getDefaultVideoSelections());
        setActiveVideo(null);
      }
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingLibrary(false);
    }
  };

  return (
    <section className={`${styles.workspace} mx-auto flex w-full flex-col`} aria-label="Video regulation workspace">
      <header className={`${styles.header} flex items-start justify-between`}>
        <div>
          <div className={styles.eyebrow}>视频调节刺激</div>
          <h1 className={styles.title}>Video Regulation</h1>
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
          <button className={styles.libraryButton} type="button" onClick={chooseLibraryFolder} disabled={loadingLibrary}>
            {loadingLibrary ? '加载中' : '选择视频库'}
          </button>
        </div>
      </header>

      <div className={`${styles.libraryNotice} grid`}>
        <span>{videoLibrary ? '当前视频库' : '默认视频库'}</span>
        <code>{libraryRoot}</code>
        {libraryError ? <strong>{libraryError}</strong> : null}
      </div>

      <div className={`${styles.contentGrid} ${hasStartedSelection ? styles.withResults : ''} grid`}>
        <main className={`${styles.selectorPanel} grid`} aria-label="Video tag selectors">
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

        <aside className={`${styles.libraryPanel} grid`} aria-label="Filtered video library">
          <div className={`${styles.panelHeader} grid`}>
            <span>{hasStartedSelection ? '当前候选' : '选择后推荐'}</span>
            <strong>{hasStartedSelection ? `${videos.length} 个匹配` : '完成标签后自动播放'}</strong>
          </div>

          {hasStartedSelection ? (
            <div className={`${styles.videoList} grid`}>
              {videos.length > 0 ? (
              videos.map((video) => (
                <article key={video.id} className={`${styles.videoCard} grid`}>
                  <div className={`${styles.thumbnail} grid place-items-center`} aria-hidden="true">
                    <PlayArrowRoundedIcon />
                  </div>
                  <div className={`${styles.videoMeta} grid min-w-0`}>
                    <span>{video.durationLabel}</span>
                    <h2>{video.title}</h2>
                    <p>{video.summary}</p>
                    <div className={`${styles.tagChipList} flex flex-wrap`}>
                      {getVisibleTags(video).map((tag) => (
                        <span key={tag} className={styles.tagChip}>{tag}</span>
                      ))}
                    </div>
                    <code>{video.sourcePath}</code>
                  </div>
                  <button className={styles.startButton} type="button" onClick={() => setActiveVideo(video)}>
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
        <div
          className={`${playerStyles.videoOverlay} fixed inset-0 z-30 flex items-center justify-center`}
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setActiveVideo(null);
            }
          }}
        >
          <section
            className={`${playerStyles.videoModal} grid w-full`}
            aria-label="Regulation video player"
            onClick={(event) => event.stopPropagation()}
          >
            <header className={`${playerStyles.videoModalHeader} flex items-center justify-between`}>
              <div className="min-w-0">
                <span>视频播放</span>
                <strong>{activeVideo.title}</strong>
                <code>{activeVideo.sourcePath}</code>
              </div>
              <button
                type="button"
                className={playerStyles.closeButton}
                aria-label="Close regulation video"
                onClick={() => setActiveVideo(null)}
              >
                <CloseRoundedIcon />
              </button>
            </header>
            <div className={playerStyles.videoFrame}>
              <video
                key={activeVideo.id}
                autoPlay
                controls
                src={toPlayableVideoUrl(activeVideo.sourcePath, convertFileSrc)}
              />
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
