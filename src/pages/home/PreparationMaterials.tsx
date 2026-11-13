import { open } from '@tauri-apps/plugin-dialog';
import { loadParadigmVideoLibrary } from '../../paradigm/paradigmApi';
import { writeStoredLibraryRootPath } from '../../paradigm/paradigmStorage';
import styles from './ExperimentSettings.module.css';
import guide from './ExperimentPreparation.module.css';
import type { ExperimentDestination } from '../../experiment/preparation';
type Props = {
  locked: boolean;
  desktop: boolean;
  library: string;
  setLibrary: (s: string) => void;
  librarySummary: string;
  setLibrarySummary: (s: string) => void;
  setValidatedLibrary: (s: string) => void;
  destination: ExperimentDestination;
  perform: (key: string, context: string, action: () => Promise<void>) => Promise<void>;
  busyClass: (key: string) => string;
};
export default function PreparationMaterials({
  locked,
  desktop,
  library,
  setLibrary,
  librarySummary,
  setLibrarySummary,
  setValidatedLibrary,
  destination,
  perform,
  busyClass,
}: Props) {
  return (
    <>
      <p className={guide.introduction}>
        选择诱发与视频调控素材库。已有素材库会自动检查，无需每次重新选择。
      </p>
      <label>
        素材库根目录
        <input
          disabled={locked}
          value={library}
          onChange={(event) => {
            setLibrary(event.target.value);
            setValidatedLibrary('');
            setLibrarySummary('');
          }}
        />
      </label>
      <div className={styles.row}>
        <button
          type="button"
          disabled={locked || !desktop}
          className={`${styles.ghostButton} ${busyClass('pickFolder')}`}
          onClick={() =>
            void perform('pickFolder', '选择素材库目录', async () => {
              const chosen = await open({
                directory: true,
                multiple: false,
                title: '选择范式素材库',
              });
              if (typeof chosen === 'string') {
                setLibrary(chosen);
                setValidatedLibrary('');
                setLibrarySummary('');
              }
            })
          }
        >
          选择文件夹
        </button>
        <button
          type="button"
          disabled={locked || !desktop || !library.trim()}
          className={busyClass('validateLibrary')}
          onClick={() =>
            void perform('validateLibrary', '验证素材库', async () => {
              const loaded = await loadParadigmVideoLibrary(library.trim());
              if (!loaded.valid) {
                setValidatedLibrary('');
                setLibrarySummary('');
                throw new Error(loaded.problems.join('；') || '素材库未通过验证。');
              }
              writeStoredLibraryRootPath(library.trim());
              setValidatedLibrary(library.trim());
              setLibrarySummary(
                `素材库已验证：焦虑 ${loaded.anxiety.length}、抑郁 ${loaded.depression.length}、恐惧 ${loaded.fear.length}、平静 ${loaded.calm.length}。`,
              );
            })
          }
        >
          验证并保存素材库
        </button>
      </div>
      {librarySummary && (
        <p className={styles.muted} role="status">
          {librarySummary}
        </p>
      )}
      {destination === 'effect' && (
        <p className={styles.muted}>音乐曲目需提前在音乐调控页准备；本页验证的是视频素材。</p>
      )}
    </>
  );
}
