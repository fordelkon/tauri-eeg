import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { getTriggerStatus } from '../experiment/api';
import { readExperimentPreferences } from '../experiment/settings';
import { isRegulationWindowOpenInStorage } from '../pages/home/effectEvaluationFlow';
import ParadigmVideoPreview from './ParadigmVideoPreview';
import { buildParadigmQueue } from './paradigmApi';
import { useParadigmVideoLibrary } from './useParadigmVideoLibrary';
import { ParadigmLibraryList } from './ParadigmLibraryList';
import {
  readStoredSubjectId,
  writeStoredSubjectId,
} from '../storage/currentSubject';
import {
  PARADIGM_BLOCKS_BY_KIND,
  PARADIGM_EMOTION_DISPLAY_ORDER,
  PARADIGM_TRIALS_PER_CLASS,
  paradigmEmotionLabels,
} from './types';
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
  /** Rehearsal records events and ratings without hardware output. */
  dryRun: boolean;
};

export type StartedParadigmRequest = ParadigmStartRequest & { runId: string };

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
  const [triggerConnected, setTriggerConnected] = useState(false);
  const preferences = readExperimentPreferences();
  useEffect(() => {
    let disposed = false;
    const refresh = () => void getTriggerStatus().then((status) => {
      if (!disposed) setTriggerConnected(status.connected);
    }).catch(() => { if (!disposed) setTriggerConnected(false); });
    refresh();
    window.addEventListener('focus', refresh);
    return () => { disposed = true; window.removeEventListener('focus', refresh); };
  }, []);
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
  const [dryRun, setDryRun] = useState(() => preferences.mode === 'rehearsal');
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
  const scheduleHint = activeBlocks.length === 1
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

  const devicesReady = triggerConnected && preferences.externalRecordingConfirmed;
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
      ? '排练模式：保存实验日志，不发送硬件 Trigger。'
      : !devicesReady
        ? '请到实验设置连接 Trigger，并确认 ActiView 已开始保存 BDF。'
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
      setQueueError('效果评价调控进行中，请先回到「效果评价」结束或跳过本次调控，再开始实验范式。');
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



  return (
    <div className={styles.panel} aria-label="实验范式设置">
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

        {library && library.readinessWarnings.length > 0 ? (
          <div className={styles.warningBanner} role="note">
            {library.readinessWarnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
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
            title="排练不发送硬件 Trigger，仍保存实验事件与 SAM"
            className={`${styles.pillRadio} ${dryRun ? styles.selectedPillRadio : ''}`}
            onClick={() => setDryRun((value) => !value)}
          >
            排练
          </button>
          <span className={`${styles.deviceLight} ${styles.miniLight} ${triggerConnected ? styles.connectedLight : ''}`}>
            <span
              className={`${styles.deviceLightDot} ${styles.miniLightDot} ${triggerConnected ? styles.connectedLightDot : ''}`}
              aria-hidden="true"
            />
            Trigger {triggerConnected ? '已连接' : '未连接'}
          </span>

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

