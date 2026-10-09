import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import SlideshowRoundedIcon from '@mui/icons-material/SlideshowRounded';
import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMaterialLibraryLoader } from '../../paradigm/useMaterialLibrary';
import {
  buildRegulationVideos,
  filterRegulationVideos,
  getRegulationCategories,
  type RegulationVideo,
} from '../../video/paradigmRegulationCatalog';
import {
  readStoredParadigmLibraryRootPath,
  writeStoredParadigmLibraryRootPath,
} from '../../video/videoLibraryStorage';
import { setCurrentRegulationVideos } from '../../video/regulationVideoResources';
import { describeFriendlyError } from '../../ui/friendlyError';
import { isTauriAvailable } from '../../ui/tauriEnvironment';
import { RegulationSessionBanner } from './regulationSessionBanner';
import { VideoRegulationPlayerModal } from './VideoRegulationPlayerModal';
import { usePauseMediaOnChange } from './useRegulationMedia';
import { useEffectRegulationContext } from './useEffectRegulationContext';
import styles from './VideoRegulation.module.css';
import browserStyles from './VideoRegulationBrowser.module.css';

export default function VideoRegulation() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [initialRootPath] = useState(readStoredParadigmLibraryRootPath);
  const { loader, state: libraryState } = useMaterialLibraryLoader();
  const [activeVideo, setActiveVideo] = useState<RegulationVideo | null>(null);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [choosingLibrary, setChoosingLibrary] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const regulationContext = useEffectRegulationContext('video', () => {
    videoRef.current?.pause();
    setActiveVideo(null);
  });
  const library =
    libraryState.kind === 'ready' || libraryState.kind === 'invalid' ? libraryState.library : null;
  const videos = useMemo(() => buildRegulationVideos(library?.calm ?? []), [library]);
  const categories = useMemo(() => getRegulationCategories(videos), [videos]);
  const visibleVideos = useMemo(
    () => filterRegulationVideos(videos, category, search),
    [videos, category, search],
  );
  const loadingLibrary = choosingLibrary || libraryState.kind === 'loading';
  const libraryRoot = libraryState.kind === 'idle' ? initialRootPath : libraryState.rootPath;
  const libraryError = useMemo(
    () =>
      pickerError ||
      (libraryState.kind === 'failed'
        ? describeFriendlyError(libraryState.error, '加载视频库')
        : ''),
    [pickerError, libraryState],
  );

  useEffect(() => {
    void loader.load(initialRootPath);
  }, [initialRootPath, loader]);
  useEffect(() => {
    setCurrentRegulationVideos(videos);
    return () => setCurrentRegulationVideos([]);
  }, [videos]);
  usePauseMediaOnChange(videoRef, activeVideo?.id);

  useEffect(() => {
    if (!activeVideo) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveVideo(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeVideo]);

  useEffect(() => {
    const handleAgentPlayVideo = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (typeof detail !== 'object' || detail === null || !('videoId' in detail)) return;
      const video = videos.find((candidate) => candidate.id === detail.videoId);
      if (video) setActiveVideo(video);
    };
    window.addEventListener('agent:play-video', handleAgentPlayVideo);
    return () => window.removeEventListener('agent:play-video', handleAgentPlayVideo);
  }, [videos]);

  const chooseLibraryFolder = async () => {
    setChoosingLibrary(true);
    setPickerError('');
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择视频根目录',
        defaultPath: libraryRoot,
      });
      if (typeof selected !== 'string') return;
      setActiveVideo(null);
      const result = await loader.load(selected);
      if (result && (result.kind === 'ready' || result.kind === 'invalid')) {
        setCategory('');
        setSearch('');
        if (result.library.calm.length > 0) writeStoredParadigmLibraryRootPath(result.rootPath);
      }
    } catch (error) {
      setPickerError(describeFriendlyError(error, '选择视频库'));
    } finally {
      setChoosingLibrary(false);
    }
  };

  return (
    <section
      className={`${styles.workspace} mx-auto flex w-full flex-col`}
      aria-label="视频调控工作区"
    >
      <header className={`${styles.header} flex items-start justify-between`}>
        <div>
          <div className={styles.eyebrow}>视频调节刺激</div>
          <h1 className={styles.title}>视频调控</h1>
          <p className={styles.description}>
            从平静视频库中选择素材，按文件夹分类浏览，也可以搜索文件名。
          </p>
        </div>
        <div className={`${styles.statusBar} flex flex-wrap items-center justify-end`}>
          <span
            className={`${styles.statusPill} inline-flex items-center ${activeVideo ? styles.playing : styles.idle}`}
          >
            <SlideshowRoundedIcon fontSize="small" />
            {activeVideo ? '播放中' : loadingLibrary ? '加载中' : '就绪'}
          </span>
          <button
            className={styles.libraryButton}
            type="button"
            onClick={chooseLibraryFolder}
            disabled={loadingLibrary}
          >
            {loadingLibrary ? '加载中' : '选择视频根目录'}
          </button>
        </div>
      </header>
      <RegulationSessionBanner context={regulationContext} className={styles.effectSessionBanner} />
      <div className={`${styles.libraryNotice} grid`}>
        <span>当前视频库 · Calm 平静素材</span>
        <code>{libraryRoot}</code>
        {!isTauriAvailable() ? (
          <span className={styles.libraryEnvironmentNotice} role="status">
            当前为浏览器预览，本地视频读取需在桌面应用中使用。
          </span>
        ) : libraryError ? (
          <strong role="alert">{libraryError}</strong>
        ) : null}
      </div>
      <div
        className={`${styles.contentGrid} ${styles.withResults} ${browserStyles.browserGrid} grid`}
      >
        <main
          className={`${styles.selectorPanel} ${browserStyles.filterPanel} grid`}
          aria-label="视频分类选择器"
        >
          <div className={`${styles.panelHeader} grid`}>
            <span>素材分类</span>
            <strong>{videos.length} 个视频</strong>
          </div>
          <div className={browserStyles.categoryList}>
            <button
              type="button"
              className={`${browserStyles.categoryButton} ${category === '' ? browserStyles.activeCategoryButton : ''}`}
              aria-pressed={category === ''}
              onClick={() => setCategory('')}
            >
              全部 <span>{videos.length}</span>
            </button>
            {categories.map((group) => (
              <button
                key={group.value}
                type="button"
                className={`${browserStyles.categoryButton} ${category === group.value ? browserStyles.activeCategoryButton : ''}`}
                aria-pressed={category === group.value}
                onClick={() => setCategory(group.value)}
              >
                {group.label} <span>{group.count}</span>
              </button>
            ))}
          </div>
          <label className={browserStyles.searchLabel}>
            搜索视频
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="文件名或分类"
            />
          </label>
          {(category || search) && (
            <button
              type="button"
              className={styles.libraryButton}
              onClick={() => {
                setCategory('');
                setSearch('');
              }}
            >
              清除筛选
            </button>
          )}
        </main>
        <aside className={`${styles.libraryPanel} grid`} aria-label="筛选后的视频库">
          <div className={`${styles.panelHeader} grid`}>
            <span>可用素材</span>
            <strong>{visibleVideos.length} 个视频</strong>
          </div>
          {loadingLibrary ? (
            <div className={styles.emptyState} role="status">
              正在读取视频文件夹…
            </div>
          ) : visibleVideos.length > 0 ? (
            <div className={`${styles.videoList} grid`}>
              {visibleVideos.map((video) => (
                <article key={video.id} className={`${styles.videoCard} grid`}>
                  <div className={`${styles.thumbnail} grid place-items-center`} aria-hidden="true">
                    <PlayArrowRoundedIcon />
                  </div>
                  <div className={`${styles.videoMeta} ${browserStyles.fileMeta} grid min-w-0`}>
                    <h2>{video.title}</h2>
                    <p>{video.categoryLabel}</p>
                    <code>{video.relativePath}</code>
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
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              {videos.length > 0
                ? '没有匹配的视频，请调整分类或搜索词。'
                : '尚无可用的平静视频，请选择包含 Calm 子文件夹的视频根目录。'}
            </div>
          )}
        </aside>
      </div>
      {activeVideo && (
        <VideoRegulationPlayerModal
          activeVideo={activeVideo}
          videoRef={videoRef}
          onClose={() => setActiveVideo(null)}
        />
      )}
    </section>
  );
}
