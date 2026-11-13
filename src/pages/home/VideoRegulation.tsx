import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import SlideshowRoundedIcon from '@mui/icons-material/SlideshowRounded';
import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMaterialLibraryLoader } from '../../paradigm/useMaterialLibrary';
import {
  buildAllRegulationVideos,
  filterRegulationVideos,
  getEmotionSummary,
  getRegulationCategories,
  type EmotionKey,
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
import { useParticipantFullscreen } from './useParticipantFullscreen';
import { usePauseMediaOnChange } from './useRegulationMedia';
import { useEffectRegulationContext } from './useEffectRegulationContext';
import styles from './VideoRegulation.module.css';
import browserStyles from './VideoRegulationBrowser.module.css';

export default function VideoRegulation() {
  const { enterFullscreen, leaveFullscreen } = useParticipantFullscreen();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const filterScrollRef = useRef<HTMLDivElement | null>(null);
  const [initialRootPath] = useState(readStoredParadigmLibraryRootPath);
  const { loader, state: libraryState } = useMaterialLibraryLoader();
  const [activeVideo, setActiveVideo] = useState<RegulationVideo | null>(null);
  const [emotion, setEmotion] = useState<EmotionKey>('calm');
  const [category, setCategory] = useState('');
  const [waterOnly, setWaterOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [choosingLibrary, setChoosingLibrary] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const regulationContext = useEffectRegulationContext('video', () => {
    videoRef.current?.pause();
    setActiveVideo(null);
  });
  const library =
    libraryState.kind === 'ready' || libraryState.kind === 'invalid' ? libraryState.library : null;

  const videos = useMemo(() => buildAllRegulationVideos(library), [library]);
  const emotionSummary = useMemo(() => getEmotionSummary(videos), [videos]);
  const emotionVideos = useMemo(
    () => videos.filter((video) => video.emotion === emotion),
    [videos, emotion],
  );
  const categories = useMemo(() => getRegulationCategories(emotionVideos), [emotionVideos]);
  const visibleVideos = useMemo(
    () => filterRegulationVideos(videos, category, search, emotion, waterOnly),
    [videos, category, search, emotion, waterOnly],
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
    setCurrentRegulationVideos(visibleVideos);
    return () => setCurrentRegulationVideos([]);
  }, [visibleVideos]);
  useEffect(() => {
    filterScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [emotion]);
  usePauseMediaOnChange(videoRef, activeVideo?.id);

  useEffect(() => {
    if (!activeVideo) leaveFullscreen();
  }, [activeVideo, leaveFullscreen]);

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
        const total =
          (result.library.calm?.length ?? 0) +
          (result.library.anxiety?.length ?? 0) +
          (result.library.depression?.length ?? 0) +
          (result.library.fear?.length ?? 0);
        if (total > 0) writeStoredParadigmLibraryRootPath(result.rootPath);
      }
    } catch (error) {
      setPickerError(describeFriendlyError(error, '选择视频库'));
    } finally {
      setChoosingLibrary(false);
    }
  };

  const currentEmotionLabel =
    emotionSummary.find((item) => item.value === emotion)?.label ?? '平静';

  return (
    <section
      className={`${styles.workspace} mx-auto flex w-full flex-col`}
      aria-label="视频调控工作区"
    >
      <header
        className={`${styles.header} flex flex-col justify-between gap-3 md:flex-row md:items-end`}
      >
        <div>
          <span className={styles.eyebrow}>多模态实验 · 视频库浏览器</span>
          <h1 className={styles.title}>视频素材多维分层选择</h1>
          <p className={styles.description}>
            分层浏览与检索实验素材库。支持按情绪大类、场景内容与标签特征多级筛选，可用于心境调控干预或诱发视频试听。
          </p>
        </div>
        <div className={`${styles.statusBar} flex flex-wrap items-center gap-2`}>
          <span
            className={`${styles.statusPill} inline-flex items-center gap-1.5`}
            data-testid="video-library-status"
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
        <span>
          当前素材库 · {currentEmotionLabel}素材 (共 {visibleVideos.length} / {emotionVideos.length}{' '}
          部)
        </span>
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
          className={`${styles.selectorPanel} ${browserStyles.filterPanel}`}
          aria-label="视频分层选择器"
        >
          <div className={`${styles.panelHeader} grid`}>
            <span>分层筛选器</span>
            <strong>
              {visibleVideos.length} / {videos.length} 个视频
            </strong>
          </div>

          <div ref={filterScrollRef} className={browserStyles.filterScrollArea}>
            {/* 第 1 层：情绪大类 */}
            <div className={browserStyles.tierGroup}>
              <span className={browserStyles.tierHeading}>第 1 层 · 情绪维度</span>
              <div className={browserStyles.emotionTabs} role="group" aria-label="情绪大类选择">
                {emotionSummary.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={`${browserStyles.emotionButton} ${
                      emotion === item.value ? browserStyles.activeEmotionButton : ''
                    }`}
                    aria-pressed={emotion === item.value}
                    onClick={() => {
                      setEmotion(item.value);
                      setCategory('');
                    }}
                  >
                    {item.label} <span>{item.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 第 2 层：场景与分类 */}
            <div className={browserStyles.tierGroup}>
              <span className={browserStyles.tierHeading}>第 2 层 · 场景与内容分类</span>
              <div className={browserStyles.categoryList}>
                <button
                  type="button"
                  className={`${browserStyles.categoryButton} ${
                    category === '' ? browserStyles.activeCategoryButton : ''
                  }`}
                  aria-pressed={category === ''}
                  onClick={() => setCategory('')}
                >
                  全部场景 <span>{emotionVideos.length}</span>
                </button>
                {categories.map((group) => (
                  <button
                    key={group.value}
                    type="button"
                    className={`${browserStyles.categoryButton} ${
                      category === group.value ? browserStyles.activeCategoryButton : ''
                    }`}
                    aria-pressed={category === group.value}
                    onClick={() => setCategory(group.value)}
                  >
                    {group.label} <span>{group.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 第 3 层：特征过滤与搜索 */}
            <div className={browserStyles.tierGroup}>
              <span className={browserStyles.tierHeading}>第 3 层 · 特征过滤与检索</span>
              <label className={browserStyles.searchLabel}>
                搜索视频
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="输入文件名、分类或标签"
                />
              </label>
              <label className={browserStyles.filterCheckbox}>
                <input
                  type="checkbox"
                  checked={waterOnly}
                  onChange={(event) => setWaterOnly(event.target.checked)}
                />
                仅含水体/海景/雨声视频
              </label>
              {(category || search || waterOnly || emotion !== 'calm') && (
                <button
                  type="button"
                  className={styles.libraryButton}
                  onClick={() => {
                    setEmotion('calm');
                    setCategory('');
                    setSearch('');
                    setWaterOnly(false);
                  }}
                >
                  重置分层筛选
                </button>
              )}
            </div>
          </div>
        </main>
        <aside
          className={`${styles.libraryPanel} ${browserStyles.libraryPanel}`}
          aria-label="筛选后的视频库"
        >
          <div className={`${styles.panelHeader} grid`}>
            <span>当前可用素材</span>
            <strong>{visibleVideos.length} 个视频</strong>
          </div>
          {loadingLibrary ? (
            <div className={styles.emptyState} role="status">
              正在读取视频文件夹…
            </div>
          ) : visibleVideos.length > 0 ? (
            <div className={`${styles.videoList} ${browserStyles.videoListScroll} grid`}>
              {visibleVideos.map((video) => (
                <article key={video.id} className={`${styles.videoCard} grid`}>
                  <div className={`${styles.thumbnail} grid place-items-center`} aria-hidden="true">
                    <PlayArrowRoundedIcon />
                  </div>
                  <div className={`${styles.videoMeta} ${browserStyles.fileMeta} grid min-w-0`}>
                    <h2>{video.title}</h2>
                    <div className={browserStyles.videoBadges}>
                      {video.emotionLabel && (
                        <span
                          className={`${browserStyles.emotionBadge} ${
                            video.emotion === 'calm'
                              ? browserStyles.badgeCalm
                              : video.emotion === 'anxiety'
                                ? browserStyles.badgeAnxiety
                                : video.emotion === 'depression'
                                  ? browserStyles.badgeDepression
                                  : browserStyles.badgeFear
                          }`}
                        >
                          {video.emotionLabel}
                        </span>
                      )}
                      <span className={browserStyles.sceneBadge}>{video.categoryLabel}</span>
                      {video.sceneLabel && video.sceneLabel !== video.categoryLabel && (
                        <span className={browserStyles.sceneBadge}>{video.sceneLabel}</span>
                      )}
                      {video.hasWater && <span className={browserStyles.waterBadge}>含水景</span>}
                    </div>
                    <code>{video.relativePath}</code>
                  </div>
                  <button
                    className={styles.startButton}
                    type="button"
                    data-agent-action="play_video"
                    data-agent-payload={video.id}
                    title="播放视频。按 Esc 或点击画面退出。"
                    onClick={() => {
                      void enterFullscreen();
                      setActiveVideo(video);
                    }}
                  >
                    播放
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              {videos.length > 0
                ? '没有匹配的视频，请调整情绪、分类或搜索条件。'
                : '尚无可用的视频素材，请选择包含有效情绪子文件夹的视频根目录。'}
            </div>
          )}
        </aside>
      </div>
      {activeVideo && (
        <VideoRegulationPlayerModal
          key={activeVideo.id}
          activeVideo={activeVideo}
          videoRef={videoRef}
          onClose={() => setActiveVideo(null)}
        />
      )}
    </section>
  );
}
