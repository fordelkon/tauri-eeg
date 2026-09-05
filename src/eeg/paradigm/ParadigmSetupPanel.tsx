import { open } from '@tauri-apps/plugin-dialog';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useEegSession } from '../EegSessionContext';
import { isRegulationWindowOpenInStorage } from '../../pages/home/effectEvaluationFlow';
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
import { FEEDBACK_DISPLAY_MS, REGULATION_WINDOW_MS } from './paradigmTimeline';
import type {
  ParadigmEmotion,
  ParadigmSessionKind,
  ParadigmTrialPlanItem,
  ParadigmVideoEntry,
  ParadigmVideoLibrary,
} from './types';
import styles from './ParadigmSession.module.css';

export const PARADIGM_MIN_VIDEOS_PER_CLASS = 5;

/** Latency budget for the silent queue preview's backend directory scan. */
const QUEUE_PREVIEW_DEBOUNCE_MS = 300;
/** localStorage write latency budget for the subject-id memory. */
const SUBJECT_ID_PERSIST_DEBOUNCE_MS = 300;

/** Inputs the current queuePreview was built from (build_paradigm_queue is
 *  deterministic per session_run_id, so a matching preview IS the queue the
 *  backend would rebuild at start). */
type QueuePreviewInputs = {
  rootPath: string;
  sessionRunId: string;
  sessionKind: ParadigmSessionKind;
};

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
  held_out_generation: '依次诱发焦虑、抑郁、恐惧三类情绪,按流程采集评价。',
  regulation_feedback:
    '视频诱发负性情绪后进行认知重评,调控结束显示间歇式脑状态反馈;当前为模拟反馈,仅试运行模式可用。',
};

const sessionKindShortLabels: Record<ParadigmSessionKind, string> = {
  personal_calibration: '个人校准',
  held_out_generation: '独立诱发调控',
  regulation_feedback: '调控反馈',
};

const sessionKinds: readonly ParadigmSessionKind[] = [
  'personal_calibration',
  'held_out_generation',
  'regulation_feedback',
];

const libraryClassKeys: Record<ParadigmEmotion, keyof Omit<ParadigmVideoLibrary, 'rootPath' | 'valid' | 'problems'>> = {
  anxiety: 'anxiety',
  calm: 'calm',
  depression: 'depression',
  fear: 'fear',
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

type ParadigmLibraryListProps = {
  library: ParadigmVideoLibrary;
  selectedVideoIds: ReadonlySet<string>;
  onSelectPreview: (emotion: ParadigmEmotion, entry: ParadigmVideoEntry) => void;
};

/**
 * The full 素材清单: every entry of all five emotion classes as preview
 * buttons. Memoized so keystrokes in 被试 ID / 会话运行 ID — which re-render
 * the whole setup panel — do not rebuild hundreds of buttons; only a library
 * load or a queue-preview change (selection badges) re-renders the list.
 */
const ParadigmLibraryList = memo(function ParadigmLibraryList({
  library,
  selectedVideoIds,
  onSelectPreview,
}: ParadigmLibraryListProps) {
  return (
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
                    onClick={() => onSelectPreview(emotion, entry)}
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
  );
});

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
  // Inputs behind the queuePreview above: startSession reuses the previewed
  // queue when these still match, skipping the second backend directory scan.
  const queuePreviewInputsRef = useRef<QueuePreviewInputs | null>(null);
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
  // Debounced subject-id persistence: localStorage.setItem per keystroke
  // stalls fast typing, so the write waits for a pause and is flushed on
  // unmount so navigating away cannot lose the last typed value.
  const subjectIdPersistTimerRef = useRef<number | null>(null);
  const pendingSubjectIdRef = useRef<string | null>(null);

  const selectedVideoIds = useMemo(
    () => new Set((queuePreview ?? []).map((item) => item.videoId)),
    [queuePreview],
  );

  const activeBlocks = PARADIGM_BLOCKS_BY_KIND[sessionKind];
  const scheduleText = activeBlocks.map((emotion) => paradigmEmotionLabels[emotion]).join(' → ');
  const scheduleHint = sessionKind === 'regulation_feedback'
    ? `${scheduleText} · 每个视频结束后进行 ${REGULATION_WINDOW_MS / 1000} 秒认知重评,再显示 ${FEEDBACK_DISPLAY_MS / 1000} 秒间歇式反馈`
    : activeBlocks.length === 1
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
  // id, and session kind are all present. build_paradigm_queue is
  // deterministic per session_run_id, so startSession reuses this queue (see
  // queuePreviewInputsRef) instead of rescanning the directory on the
  // start-click latency path.
  useEffect(() => {
    if (!library?.valid || !sessionRunId) {
      return;
    }

    let disposed = false;
    const timer = window.setTimeout(() => {
      buildParadigmQueue(library.rootPath, sessionRunId.trim(), sessionKind)
        .then((queue) => {
          if (!disposed) {
            queuePreviewInputsRef.current = {
              rootPath: library.rootPath,
              sessionRunId: sessionRunId.trim(),
              sessionKind,
            };
            setQueuePreview(queue);
          }
        })
        .catch((error) => {
          if (!disposed) {
            setQueueError(toLibraryErrorMessage(error));
          }
        });
    }, QUEUE_PREVIEW_DEBOUNCE_MS);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [library, sessionRunId, sessionKind]);

  // A changed input invalidates the previewed queue, so every input-changing
  // path clears both the queue and the inputs it was built from.
  const clearQueuePreview = useCallback(() => {
    queuePreviewInputsRef.current = null;
    setQueuePreview(null);
  }, []);

  const updateSessionKind = useCallback((kind: ParadigmSessionKind) => {
    setSessionKind(kind);
    clearQueuePreview();
  }, [clearQueuePreview]);

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
  // The regulation rehearsal has no real decoder yet: its feedback values are
  // simulated, so starting it against live hardware/recording is meaningless
  // and the run is limited to dry-run mode.
  const regulationNeedsDryRun = sessionKind === 'regulation_feedback' && !dryRun;
  const canStartSession = (
    (dryRun || devicesReady)
    && libraryValid
    && subjectIdTrimmed.length > 0
    && sessionRunIdTrimmed.length > 0
    && !regulationNeedsDryRun
    && !startPending
    && !startingSession
  );

  // One-line readiness reason, highest priority first (E-Prime startup style).
  const notReadyReason = regulationNeedsDryRun
    ? '调控反馈范式当前仅支持试运行模式(反馈为模拟解码值,不连接设备)。'
    : dryRun
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

  // Stable handler handed to the memoized ParadigmLibraryList so the list
  // never re-renders because of a new preview-opening closure.
  const handlePreviewSelect = useCallback((emotion: ParadigmEmotion, entry: ParadigmVideoEntry) => {
    setPreviewVideo({ emotion, entry });
  }, []);

  const updateSubjectId = useCallback((value: string) => {
    // React state stays immediate; only the localStorage write is debounced.
    setSubjectId(value);
    pendingSubjectIdRef.current = value;
    if (subjectIdPersistTimerRef.current !== null) {
      window.clearTimeout(subjectIdPersistTimerRef.current);
    }
    subjectIdPersistTimerRef.current = window.setTimeout(() => {
      subjectIdPersistTimerRef.current = null;
      const pending = pendingSubjectIdRef.current;
      pendingSubjectIdRef.current = null;
      if (pending !== null) {
        writeStoredSubjectId(pending);
      }
    }, SUBJECT_ID_PERSIST_DEBOUNCE_MS);
  }, []);

  // Flush the pending debounced subject-id write when the panel unmounts
  // (navigation, session start) so the last typed value is never lost.
  useEffect(() => {
    return () => {
      if (subjectIdPersistTimerRef.current !== null) {
        window.clearTimeout(subjectIdPersistTimerRef.current);
        subjectIdPersistTimerRef.current = null;
      }
      const pending = pendingSubjectIdRef.current;
      pendingSubjectIdRef.current = null;
      if (pending !== null) {
        writeStoredSubjectId(pending);
      }
    };
  }, []);

  const markFieldTouched = useCallback((field: keyof typeof touchedFields) => {
    setTouchedFields((current) => (current[field] ? current : { ...current, [field]: true }));
  }, []);

  const updateSessionRunId = useCallback((value: string) => {
    setSessionRunId(value);
    clearQueuePreview();
  }, [clearQueuePreview]);

  const chooseLibraryRoot = useCallback(async () => {
    setLoadingLibrary(true);
    setLibraryError(null);
    clearQueuePreview();
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
  }, [clearQueuePreview]);

  const startSession = useCallback(async () => {
    if (!library || !canStartSession) {
      return;
    }

    // Reverse half of the paradigm/effect-evaluation mutual exclusion
    // (R4/F4): a live regulation window owns the operator's attention and
    // possibly the EEG recording, mirroring the wizard's own paradigm check.
    if (isRegulationWindowOpenInStorage(window.sessionStorage)) {
      setQueueError('效果评价调控进行中，请先回到「效果评价」结束或跳过本次调控，再开始范式采集。');
      return;
    }

    // Any start attempt reveals blank-field errors even without a blur.
    setTouchedFields({ sessionRunId: true, subjectId: true });
    setStartingSession(true);

    try {
      // build_paradigm_queue is deterministic per session_run_id: when the
      // current preview was built from exactly these inputs, reuse it instead
      // of paying for a second backend directory scan on the start path.
      const previewInputs = queuePreviewInputsRef.current;
      const canReusePreview = queuePreview !== null
        && previewInputs !== null
        && previewInputs.rootPath === library.rootPath
        && previewInputs.sessionRunId === sessionRunIdTrimmed
        && previewInputs.sessionKind === sessionKind;
      const queue = canReusePreview
        ? queuePreview
        : await buildParadigmQueue(library.rootPath, sessionRunIdTrimmed, sessionKind);
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
    queuePreview,
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
          <ParadigmLibraryList
            library={library}
            selectedVideoIds={selectedVideoIds}
            onSelectPreview={handlePreviewSelect}
          />
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
