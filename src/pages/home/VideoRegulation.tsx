import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import SlideshowRoundedIcon from '@mui/icons-material/SlideshowRounded';
import { IconButton } from '@mui/material';
import { convertFileSrc } from '@tauri-apps/api/core';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import {
  emotionTargetOptions,
  getDefaultVideoSelections,
  getVideoRegulationCatalog,
  stimulusLevelOptions,
  toPlayableVideoUrl,
  type VideoRegulationAsset,
  type VideoRegulationSelections,
  videoTypeOptions,
} from '../../video/videoRegulationCatalog';
import type { CompactTagOption } from '../../music/musicRegulationTags';
import styles from './VideoRegulation.module.css';

const tagColors = ['#48a868', '#e16d4f', '#e3a22c', '#4d7fc8', '#9c6ade'] as const;

type TagGroupProps = {
  colors: readonly string[];
  label: string;
  options: readonly CompactTagOption[];
  selectedValues: string[];
  onToggle: (value: string) => void;
};

function TagGroup({ colors, label, options, selectedValues, onToggle }: TagGroupProps) {
  return (
    <section className={`${styles.tagGroup} grid`} aria-label={label}>
      <div className={`${styles.tagGroupHeader} flex items-center justify-between`}>
        <span>{label}</span>
        <strong>{selectedValues.length}/{options.length}</strong>
      </div>
      <div className={`${styles.tagList} flex flex-wrap`}>
        {options.map((option, index) => {
          const selected = selectedValues.includes(option.value);

          return (
            <button
              key={option.value}
              className={`${styles.tagButton} ${selected ? styles.activeTagButton : ''}`}
              style={{ '--tag-color': colors[index % colors.length] } as CSSProperties}
              type="button"
              onClick={() => onToggle(option.value)}
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

function toggleSelection(values: string[], value: string) {
  if (values.includes(value)) {
    return values.length > 1 ? values.filter((selectedValue) => selectedValue !== value) : values;
  }

  return [...values, value];
}

export default function VideoRegulation() {
  const [selections, setSelections] = useState<VideoRegulationSelections>(() => getDefaultVideoSelections());
  const [activeVideo, setActiveVideo] = useState<VideoRegulationAsset | null>(null);
  const videos = useMemo(() => getVideoRegulationCatalog(selections), [selections]);
  const isPlaying = activeVideo !== null;

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

  const updateSelections = (key: keyof VideoRegulationSelections, value: string) => {
    setSelections((currentSelections) => ({
      ...currentSelections,
      [key]: toggleSelection(currentSelections[key], value),
    }));
  };

  return (
    <section className={`${styles.workspace} mx-auto flex w-full flex-col`} aria-label="Video regulation workspace">
      <header className={`${styles.header} flex items-start justify-between`}>
        <div>
          <div className={styles.eyebrow}>Regulation Stimulus</div>
          <h1 className={styles.title}>Video Regulation</h1>
          <p className={styles.description}>
            Select regulation tags, then start the large playback window for local video stimulus.
          </p>
        </div>
        <div className={`${styles.statusBar} flex flex-wrap items-center justify-end`}>
          <span className={`${styles.statusPill} inline-flex items-center ${isPlaying ? styles.playing : styles.idle}`}>
            <SlideshowRoundedIcon fontSize="small" />
            {isPlaying ? 'Playing' : 'Ready'}
          </span>
          <span>{videos.length} local video</span>
        </div>
      </header>

      <div className={`${styles.contentGrid} grid`}>
        <aside className={`${styles.selectorPanel} grid`} aria-label="Video tag selectors">
          <div className={`${styles.panelHeader} grid`}>
            <span>Tag Selection</span>
            <strong>Choose stimulus profile</strong>
          </div>
          <TagGroup
            label="Emotion target"
            options={emotionTargetOptions}
            selectedValues={selections.emotionTargets}
            colors={tagColors}
            onToggle={(value) => updateSelections('emotionTargets', value)}
          />
          <TagGroup
            label="Video type"
            options={videoTypeOptions}
            selectedValues={selections.videoTypes}
            colors={tagColors}
            onToggle={(value) => updateSelections('videoTypes', value)}
          />
          <TagGroup
            label="Stimulus intensity"
            options={stimulusLevelOptions}
            selectedValues={selections.stimulusLevels}
            colors={tagColors}
            onToggle={(value) => updateSelections('stimulusLevels', value)}
          />
        </aside>

        <main className={`${styles.libraryPanel} grid`} aria-label="Filtered video library">
          <div className={`${styles.panelHeader} grid`}>
            <span>Local Video Library</span>
            <strong>Current matched stimulus</strong>
          </div>

          <div className={`${styles.videoList} grid`}>
            {videos.map((video) => (
              <article key={video.id} className={`${styles.videoCard} grid`}>
                <div className={`${styles.thumbnail} grid place-items-center`} aria-hidden="true">
                  <PlayArrowRoundedIcon />
                </div>
                <div className={`${styles.videoMeta} grid min-w-0`}>
                  <span>{video.durationLabel}</span>
                  <h2>{video.title}</h2>
                  <p>{video.summary}</p>
                  <code>{video.sourcePath}</code>
                </div>
                <button
                  className={styles.startButton}
                  type="button"
                  onClick={() => setActiveVideo(video)}
                >
                  Start Regulation
                </button>
              </article>
            ))}
          </div>
        </main>
      </div>

      {activeVideo ? (
        <div
          className={`${styles.videoOverlay} fixed inset-0 z-30 flex items-center justify-center`}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setActiveVideo(null);
            }
          }}
        >
          <section className={`${styles.videoModal} grid w-full`} aria-label="Regulation video player">
            <header className={`${styles.videoModalHeader} flex items-center justify-between`}>
              <div className="min-w-0">
                <span>Regulation Mode</span>
                <strong>{activeVideo.title}</strong>
              </div>
              <IconButton
                className={styles.closeButton}
                aria-label="Close regulation video"
                onClick={() => setActiveVideo(null)}
              >
                <CloseRoundedIcon />
              </IconButton>
            </header>
            <div className={styles.videoFrame}>
              <video
                key={activeVideo.id}
                autoPlay
                controls
                src={toPlayableVideoUrl(activeVideo.sourcePath, convertFileSrc)}
              />
            </div>
            <footer className={`${styles.videoModalFooter} flex items-center justify-between`}>
              <span>{activeVideo.sourcePath}</span>
              <button className={styles.endButton} type="button" onClick={() => setActiveVideo(null)}>
                End Session
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
