import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useEegSession } from '../EegSessionContext';
import { isRegulationWindowOpenInStorage } from '../../pages/home/effectEvaluationFlow';
import ParadigmVideoPreview from './ParadigmVideoPreview';
import { buildParadigmQueue } from './paradigmApi';
import { useParadigmVideoLibrary } from './useParadigmVideoLibrary';
import { ParadigmLibraryList } from './ParadigmLibraryList';
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
import {
  defaultSessionRunId,
  libraryClassKeys,
  sessionKindDescriptions,
  sessionKindShortLabels,
  sessionKinds,
  toLibraryErrorMessage,
} from './paradigmSessionKinds';
import type {
  ParadigmEmotion,
  ParadigmSessionKind,
  ParadigmTrialPlanItem,
  ParadigmVideoEntry,
} from './types';
import styles from './ParadigmSession.module.css';

export const PARADIGM_MIN_VIDEOS_PER_CLASS = 5;

/** localStorage write latency budget for the subject-id memory. */
const SUBJECT_ID_PERSIST_DEBOUNCE_MS = 300;

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
  // Session-only by design: a sticky dry-run flag would silently skip data
  // collection on a real run, so it resets on every app launch.
  const [dryRun, setDryRun] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const sessionKindGroupRef = useRef<HTMLDivElement>(null);
  // Video-library state (load/restore, silent queue preview, preview modal)
  // lives in its own hook; only the start gate stays on the panel.
  const {
    chooseLibraryRoot,
    clearQueuePreview,
    library,
    libraryError,
    loadingLibrary,
    previewVideo,
    queueError,
    queuePreview,
    queuePreviewInputsRef,
    selectedVideoIds,
    setPreviewVideo,
    setQueueError,
  } = useParadigmVideoLibrary({ sessionKind, sessionRunId });

  // Debounced subject-id persistence: localStorage.setItem per keystroke
  // stalls fast typing, so the write waits for a pause and is flushed on
  // unmount so navigating away cannot lose the last typed value.
  const subjectIdPersistTimerRef = useRef<number | null>(null);
  const pendingSubjectIdRef = useRef<string | null>(null);

  const activeBlocks = PARADIGM_BLOCKS_BY_KIND[sessionKind];
  const scheduleText = activeBlocks.map((emotion) => paradigmEmotionLabels[emotion]).join(' → ');
  const scheduleHint = sessionKind === 'regulation_feedback'
    ? `${scheduleText} · 每个视频结束后进行 ${REGULATION_WINDOW_MS / 1000} 秒认知重评,再显示 ${FEEDBACK_DISPLAY_MS / 1000} 秒间歇式反馈`
    : activeBlocks.length === 1
      ? `${scheduleText} · 点击开始后连续随机播放 ${PARADIGM_TRIALS_PER_CLASS} 个视频`
      : `${scheduleText} · 每类 ${PARADIGM_TRIALS_PER_CLASS} 个视频连续随机播放,阶段间休息`;

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
  }, [setPreviewVideo]);

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
    queuePreviewInputsRef,
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
