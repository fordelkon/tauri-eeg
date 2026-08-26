import { open } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useEegSession } from '../EegSessionContext';
import ParadigmVideoPreview from './ParadigmVideoPreview';
import { buildParadigmQueue, loadParadigmVideoLibrary } from './paradigmApi';
import {
  readStoredLibraryRootPath,
  writeStoredLibraryRootPath,
} from './paradigmStorage';
import {
  readStoredSubjectId,
  writeStoredSubjectId,
} from '../../storage/currentSubject';
import {
  PARADIGM_BLOCKS_BY_KIND,
  PARADIGM_EMOTION_DISPLAY_ORDER,
  PARADIGM_TRIALS_PER_CLASS,
  paradigmEmotionLabels,
} from './types';
import type {
  ParadigmEmotion,
  ParadigmSessionKind,
  ParadigmTrialPlanItem,
  ParadigmVideoEntry,
  ParadigmVideoLibrary,
} from './types';
import styles from './ParadigmSession.module.css';

export const PARADIGM_MIN_VIDEOS_PER_CLASS = 5;

export type ParadigmStartRequest = {
  sessionKind: ParadigmSessionKind;
  subjectId: string;
  sessionRunId: string;
  queue: ParadigmTrialPlanItem[];
  /** Dev mode: skip device checks and run the whole flow without writing data. */
  dryRun: boolean;
};

type Props = {
  onStartSession: (request: ParadigmStartRequest) => void;
  startPending: boolean;
  startError: string | null;
};

const sessionKindDescriptions: Record<ParadigmSessionKind, string> = {
  personal_calibration: '只采集平静基准,用于训练被试个性化情绪模型。',
  held_out_generation: '依次诱发焦虑、抑郁、快乐三类情绪,按流程采集评价。',
};

const sessionKindShortLabels: Record<ParadigmSessionKind, string> = {
  personal_calibration: '个人校准',
  held_out_generation: '独立诱发调控',
};

const sessionKinds: readonly ParadigmSessionKind[] = [
  'personal_calibration',
  'held_out_generation',
];

const libraryClassKeys: Record<ParadigmEmotion, keyof Omit<ParadigmVideoLibrary, 'rootPath' | 'valid' | 'problems'>> = {
  anxiety: 'anxiety',
  calm: 'calm',
  depression: 'depression',
  happy: 'happy',
};

function toLibraryErrorMessage(error: unknown) {
  return typeof error === 'string' ? error : error instanceof Error ? error.message : 'Failed to load paradigm video library.';
}

/** Default run id, local time: run-YYYYMMDD-HHmm (e.g. run-20260823-1945). */
function defaultSessionRunId(now: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');

  return [
    'run-',
    String(now.getFullYear()),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
  ].join('');
}

export default function ParadigmSetupPanel({
  onStartSession,
  startPending,
  startError,
}: Props) {
  const eeg = useEegSession();
  const [sessionKind, setSessionKind] = useState<ParadigmSessionKind>('personal_calibration');
  const [subjectId, setSubjectId] = useState(readStoredSubjectId);
  const [sessionRunId, setSessionRunId] = useState(() => defaultSessionRunId(new Date()));
  // Field errors stay hidden until a field is left blank on blur or a start
  // attempt, so first entry isn't greeted by two red "请填写…" lines.
  const [touchedFields, setTouchedFields] = useState({
    sessionRunId: false,
    subjectId: false,
  });
  const [library, setLibrary] = useState<ParadigmVideoLibrary | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [queuePreview, setQueuePreview] = useState<ParadigmTrialPlanItem[] | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [startingSession, setStartingSession] = useState(false);
  // Session-only by design: a sticky dry-run flag would silently skip data
  // collection on a real run, so it resets on every app launch.
  const [dryRun, setDryRun] = useState(false);
  const sessionKindGroupRef = useRef<HTMLDivElement>(null);
  const [previewVideo, setPreviewVideo] = useState<{
    emotion: ParadigmEmotion;
    entry: ParadigmVideoEntry;
  } | null>(null);

  const selectedVideoIds = useMemo(
    () => new Set((queuePreview ?? []).map((item) => item.videoId)),
    [queuePreview],
  );

  const activeBlocks = PARADIGM_BLOCKS_BY_KIND[sessionKind];
  const scheduleText = activeBlocks.map((emotion) => paradigmEmotionLabels[emotion]).join(' → ');
  const scheduleHint = activeBlocks.length === 1
    ? `${scheduleText} · 点击开始后连续随机播放 ${PARADIGM_TRIALS_PER_CLASS} 个视频`
    : `${scheduleText} · 每类 ${PARADIGM_TRIALS_PER_CLASS} 个视频连续随机播放,阶段间休息`;

  // Restore the last validated video library root on mount (same best-effort
  // memory as subjectId). A directory that has gone missing or no longer
  // passes validation silently degrades to the unselected state.
  useEffect(() => {
    const storedRootPath = readStoredLibraryRootPath();
    if (!storedRootPath) {
      return;
    }

    let disposed = false;

    loadParadigmVideoLibrary(storedRootPath)
      .then((loaded) => {
        if (disposed) {
          return;
        }

        if (loaded.valid) {
          // Keep whichever library is already present (e.g. one the operator
          // just picked while the restore was in flight).
          setLibrary((current) => current ?? loaded);
        } else {
          writeStoredLibraryRootPath('');
        }
      })
      .catch(() => {
        // Directory may be unavailable (unplugged drive etc.); stay unselected.
      });

    return () => {
      disposed = true;
    };
  }, []);

  // Silent queue preview: feeds the 入选 badges whenever a valid library, run
  // id, and session kind are all present. Deterministic per run id, so the
  // executed queue rebuilt at start is guaranteed to match.
  useEffect(() => {
    if (!library?.valid || !sessionRunId) {
      return;
    }

    let disposed = false;
    const timer = window.setTimeout(() => {
      buildParadigmQueue(library.rootPath, sessionRunId.trim(), sessionKind)
        .then((queue) => {
          if (!disposed) {
            setQueuePreview(queue);
          }
        })
        .catch((error) => {
          if (!disposed) {
            setQueueError(toLibraryErrorMessage(error));
          }
        });
    }, 300);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [library, sessionRunId, sessionKind]);

  const updateSessionKind = useCallback((kind: ParadigmSessionKind) => {
    setSessionKind(kind);
    setQueuePreview(null);
  }, []);

  // WAI-ARIA radio pattern: ArrowLeft/ArrowRight move to (and select) the
  // neighbouring pill with wrap-around; focus follows the selection. The
  // buttons carry roving tabindex so Tab enters and leaves the group once.
  const handleSessionKindKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
      }

      event.preventDefault();
      const offset = event.key === 'ArrowRight' ? 1 : -1;
      const currentIndex = sessionKinds.indexOf(sessionKind);
      const nextKind = sessionKinds[
        (currentIndex + offset + sessionKinds.length) % sessionKinds.length
      ];

      updateSessionKind(nextKind);
      sessionKindGroupRef.current
        ?.querySelector<HTMLButtonElement>(`[data-session-kind="${nextKind}"]`)
        ?.focus();
    },
    [sessionKind, updateSessionKind],
  );

  // The session context is the single source of truth: the EEG light mirrors
  // the reconciled state machine, and trigger connectivity arrives over the
  // same status event stream. No backend polling.
  const eegConnected = eeg.deviceStatus === 'streaming';
  const triggerConnected = eeg.triggerConnected;
  const devicesReady = eegConnected && triggerConnected;
  const subjectIdTrimmed = subjectId.trim();
  const sessionRunIdTrimmed = sessionRunId.trim();
  const libraryValid = library?.valid ?? false;
  const canStartSession = (
    (dryRun || devicesReady)
    && libraryValid
    && subjectIdTrimmed.length > 0
    && sessionRunIdTrimmed.length > 0
    && !startPending
    && !startingSession
  );

  // One-line readiness reason, highest priority first (E-Prime startup style).
  const notReadyReason = dryRun
    ? '试运行模式:跳过设备检查,数据不写入。'
    : !devicesReady
      ? '等待 EEG 与 Trigger 连接…'
      : !libraryValid
        ? '等待有效的视频根目录…'
        : subjectIdTrimmed.length === 0
          ? '请填写被试 ID'
          : sessionRunIdTrimmed.length === 0
            ? '请填写本次唯一的会话运行 ID'
            : null;

  const updateSubjectId = useCallback((value: string) => {
    setSubjectId(value);
    writeStoredSubjectId(value);
  }, []);

  const markFieldTouched = useCallback((field: keyof typeof touchedFields) => {
    setTouchedFields((current) => (current[field] ? current : { ...current, [field]: true }));
  }, []);

  const updateSessionRunId = useCallback((value: string) => {
    setSessionRunId(value);
    setQueuePreview(null);
  }, []);

  const chooseLibraryRoot = useCallback(async () => {
    setLoadingLibrary(true);
    setLibraryError(null);
    setQueuePreview(null);
    setQueueError(null);
    setPreviewVideo(null);

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择范式视频根目录',
      });

      if (typeof selected !== 'string') {
        return;
      }

      const loaded = await loadParadigmVideoLibrary(selected);
      setLibrary(loaded);
      // Only validated roots are remembered so the next launch restores a
      // usable library; an invalid pick clears any stale stored path.
      writeStoredLibraryRootPath(loaded.valid ? selected : '');
      if (!loaded.valid) {
        setLibraryError('视频库校验未通过,请根据提示调整目录内容。');
      }
    } catch (error) {
      setLibraryError(toLibraryErrorMessage(error));
    } finally {
      setLoadingLibrary(false);
    }
  }, []);

  const startSession = useCallback(async () => {
    if (!library || !canStartSession) {
      return;
    }

    // Any start attempt reveals blank-field errors even without a blur.
    setTouchedFields({ sessionRunId: true, subjectId: true });
    setStartingSession(true);

    try {
      // build_paradigm_queue is deterministic per session_run_id, so the
      // preview and the executed queue are guaranteed to match.
      const queue = await buildParadigmQueue(library.rootPath, sessionRunIdTrimmed, sessionKind);
      onStartSession({
        sessionKind,
        subjectId: subjectIdTrimmed,
        sessionRunId: sessionRunIdTrimmed,
        queue,
        dryRun,
      });
    } catch (error) {
      setQueueError(toLibraryErrorMessage(error));
    } finally {
      setStartingSession(false);
    }
  }, [
    canStartSession,
    dryRun,
    library,
    onStartSession,
    sessionKind,
    sessionRunIdTrimmed,
    subjectIdTrimmed,
  ]);

  const startingDevice = eeg.deviceStatus === 'starting';

  return (
    <div className={styles.panel} aria-label="范式采集设置">
      <section className={styles.panelSection} aria-label="实验信息">
        <h2 className={styles.sectionTitle}>实验信息</h2>
        <p className={styles.sectionHint}>{scheduleHint}</p>

        <div className={styles.fieldGrid}>
          <label className={styles.fieldLabel}>
            <span>被试 ID</span>
            <input
              className={styles.textInput}
              value={subjectId}
              onChange={(event) => updateSubjectId(event.currentTarget.value)}
              onBlur={() => markFieldTouched('subjectId')}
              placeholder="例如 subj-001"
              autoComplete="off"
            />
            {touchedFields.subjectId && subjectIdTrimmed.length === 0 ? (
              <span className={styles.fieldError}>请填写被试 ID</span>
            ) : null}
          </label>
          <label className={styles.fieldLabel}>
            <span>会话运行 ID</span>
            <input
              className={styles.textInput}
              value={sessionRunId}
              onChange={(event) => updateSessionRunId(event.currentTarget.value)}
              onBlur={() => markFieldTouched('sessionRunId')}
              placeholder="例如 run-20260823-1945"
              autoComplete="off"
            />
            {touchedFields.sessionRunId && sessionRunIdTrimmed.length === 0 ? (
              <span className={styles.fieldError}>请填写本次唯一的会话运行 ID</span>
            ) : null}
          </label>
        </div>

        <div
          ref={sessionKindGroupRef}
          className={styles.pillRadioRow}
          role="radiogroup"
          aria-label="实验类型"
          onKeyDown={handleSessionKindKeyDown}
        >
          <span className={styles.pillRadioLabel}>实验类型:</span>
          {sessionKinds.map((kind) => {
            const isSelected = sessionKind === kind;

            return (
              <button
                key={kind}
                type="button"
                role="radio"
                data-session-kind={kind}
                aria-checked={isSelected}
                tabIndex={isSelected ? 0 : -1}
                title={sessionKindDescriptions[kind]}
                className={`${styles.pillRadio} ${isSelected ? styles.selectedPillRadio : ''}`}
                onClick={() => updateSessionKind(kind)}
              >
                {sessionKindShortLabels[kind]}
              </button>
            );
          })}
        </div>

        <div className={styles.subSectionRow} aria-hidden="true">视频素材</div>

        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={loadingLibrary}
            onClick={() => void chooseLibraryRoot()}
          >
            {loadingLibrary ? '读取中…' : '选择视频根目录'}
          </button>
          {library ? <code>{library.rootPath}</code> : <span>未选择目录</span>}
        </div>

        {library ? (
          <div className={styles.librarySummary}>
            {PARADIGM_EMOTION_DISPLAY_ORDER.map((emotion) => {
              const count = library[libraryClassKeys[emotion]].length;
              const isUnused = !activeBlocks.includes(emotion);

              return (
                <span
                  key={emotion}
                  className={`${styles.classChip} ${count < PARADIGM_MIN_VIDEOS_PER_CLASS ? styles.isShort : ''} ${isUnused ? styles.isUnused : ''}`}
                  title={isUnused ? '当前实验类型不采集该类别' : undefined}
                >
                  {paradigmEmotionLabels[emotion]} {count} 个
                </span>
              );
            })}
          </div>
        ) : null}

        {library && library.problems.length > 0 ? (
          <ul className={styles.problemList}>
            {library.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}

        {library ? (
          <details className={styles.videoListDetails}>
            <summary className={styles.videoListSummary}>素材清单(点击文件名全屏预览)</summary>
            <div className={styles.videoListGrid} aria-label="素材清单">
              {PARADIGM_EMOTION_DISPLAY_ORDER.map((emotion) => {
                const entries = library[libraryClassKeys[emotion]];

                return (
                  <div key={emotion} className={styles.videoListGroup}>
                    <span className={styles.videoListHeader}>
                      {paradigmEmotionLabels[emotion]}({entries.length})
                    </span>
                    {entries.map((entry) => {
                      const isSelected = selectedVideoIds.has(entry.videoId);

                      return (
                        <button
                          key={entry.fileName}
                          type="button"
                          className={styles.videoListRow}
                          onClick={() => setPreviewVideo({ emotion, entry })}
                        >
                          <span className={styles.videoListName}>{entry.fileName}</span>
                          {isSelected ? (
                            <span className={styles.selectedVideoBadge}>入选</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </details>
        ) : null}

        {libraryError ? <div className={styles.warningBanner}>{libraryError}</div> : null}
        {queueError ? <div className={styles.warningBanner}>{queueError}</div> : null}

        <div className={styles.subSectionRow} aria-hidden="true">就绪</div>

        <div className={styles.readinessRow}>
          <button
            type="button"
            role="switch"
            aria-checked={dryRun}
            title="开发调试用:不连接设备、不写入数据,仅走通流程"
            className={`${styles.pillRadio} ${dryRun ? styles.selectedPillRadio : ''}`}
            onClick={() => setDryRun((value) => !value)}
          >
            试运行
          </button>
          <span className={`${styles.deviceLight} ${styles.miniLight} ${eegConnected ? styles.connectedLight : ''}`}>
            <span
              className={`${styles.deviceLightDot} ${styles.miniLightDot} ${eegConnected ? styles.connectedLightDot : ''}`}
              aria-hidden="true"
            />
            EEG {eegConnected ? '已连接' : '未连接'}
          </span>
          <span className={`${styles.deviceLight} ${styles.miniLight} ${triggerConnected ? styles.connectedLight : ''}`}>
            <span
              className={`${styles.deviceLightDot} ${styles.miniLightDot} ${triggerConnected ? styles.connectedLightDot : ''}`}
              aria-hidden="true"
            />
            Trigger {triggerConnected ? '已连接' : '未连接'}
          </span>
          {/* Recovery path stays reachable unless both lights confirm
              readiness, so a blocked start gate can never leave the operator
              without a way to (re)start the device. */}
          {!devicesReady ? (
            <button
              type="button"
              className={`${styles.secondaryButton} ${styles.miniButton}`}
              disabled={!eeg.canStartDevice || startingDevice}
              onClick={() => void eeg.startDevice()}
            >
              {startingDevice ? '连接中…' : '启动设备'}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!canStartSession}
            onClick={() => void startSession()}
          >
            {startPending || startingSession ? '启动中…' : '开始实验'}
          </button>
        </div>

        {notReadyReason ? <p className={styles.sectionHint}>{notReadyReason}</p> : null}

        {startError ? <div className={styles.errorBanner}>{startError}</div> : null}
      </section>

      {previewVideo ? (
        <ParadigmVideoPreview
          emotion={previewVideo.emotion}
          entry={previewVideo.entry}
          onClose={() => setPreviewVideo(null)}
        />
      ) : null}
    </div>
  );
}
