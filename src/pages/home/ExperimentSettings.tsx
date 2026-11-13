import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTriggerStatus, listTriggerPorts, type TriggerPort } from '../../experiment/api';
import { readExperimentPreferences, writeExperimentPreferences } from '../../experiment/settings';
import { getPreparationReadiness, type ExperimentDestination } from '../../experiment/preparation';
import { loadParadigmVideoLibrary } from '../../paradigm/paradigmApi';
import { readStoredLibraryRootPath } from '../../paradigm/paradigmStorage';
import { readStoredSubjectId, writeStoredSubjectId } from '../../storage/currentSubject';
import { useAuth } from '../../auth/AuthContext';
import {
  recordingPlanKey,
  reserveRecordingPath,
  triggerCheckPath,
} from '../../experiment/recordingPath';
import type { ParadigmSessionKind } from '../../paradigm/types';
import PreparationReview from './PreparationReview';
import PreparationMaterials from './PreparationMaterials';
import PreparationConnection from './PreparationConnection';
import RecordingPathControl from './RecordingPathControl';
import { isTauriAvailable } from '../../ui/tauriEnvironment';
import { describeFriendlyError } from '../../ui/friendlyError';
import ExperimentRunHistory from '../../experiment/ExperimentRunHistory';
import ParadigmSessionPanel from '../../paradigm/ParadigmSessionPanel';
import { createEffectEvaluationFlowState, readFlowStateFromStorage } from './effectEvaluationFlow';
import { prepareEffectHandoff, type EffectPreparationDraft } from './effectPreparationHandoff';
import PreparationPlan from './PreparationPlan';
import styles from './ExperimentSettings.module.css';
import guide from './ExperimentPreparation.module.css';

import { emptyStatus, steps } from './experimentPreparationSteps';

export default function ExperimentSettings() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [paradigmKind, setParadigmKind] = useState<ParadigmSessionKind>('personal_calibration');
  const [stage, setStage] = useState<'settings' | 'paradigm'>('settings');
  const [step, setStep] = useState(0);
  const [destination, setDestination] = useState<ExperimentDestination>('effect');
  const [effectDraft, setEffectDraft] = useState<EffectPreparationDraft>(() => {
    const saved = readFlowStateFromStorage(window.sessionStorage);
    return saved && saved.subjectId.trim() && !saved.runId && saved.step <= 1
      ? saved
      : {
          ...createEffectEvaluationFlowState(),
          subjectId:
            currentUser && /^sub-[a-z0-9]+$/i.test(currentUser.username)
              ? currentUser.username
              : readStoredSubjectId(),
        };
  });
  const [status, setStatus] = useState(emptyStatus);
  const [ports, setPorts] = useState<TriggerPort[]>([]);
  const [port, setPort] = useState('');
  const [preferences, setPreferences] = useState(readExperimentPreferences);
  const [library, setLibrary] = useState(readStoredLibraryRootPath);
  const [validatedLibrary, setValidatedLibrary] = useState('');
  const [librarySummary, setLibrarySummary] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const busy = busyKey !== '';
  const desktop = isTauriAvailable();
  const locked = busy || Boolean(status.activeRunId);
  const formal = preferences.mode === 'formal';
  const destinationLabel = destination === 'effect' ? '效果评价' : '逐试次范式';
  const plan = {
    userId: currentUser?.id ?? '',
    subjectId: effectDraft.subjectId.trim(),
    kind: destination === 'paradigm' ? paradigmKind : ('effect_evaluation' as const),
    ...(destination === 'effect' && {
      condition: effectDraft.condition,
      method: effectDraft.condition === 'regulation' ? effectDraft.method : undefined,
    }),
  };
  const planKey = recordingPlanKey(plan);
  const preparedPath =
    preferences.recordingPlanKey === planKey ? preferences.expectedRecordingName : '';
  const confirmed = Boolean(preparedPath && preferences.externalRecordingConfirmed);
  const readiness = getPreparationReadiness({
    mode: preferences.mode,
    desktop,
    connected: status.connected,
    triggerTested: status.tested,
    libraryValidated: validatedLibrary !== '' && validatedLibrary === library.trim(),
    externalRecordingConfirmed: confirmed,
    activeRunId: status.activeRunId,
  });
  const subjectMissing = !plan.subjectId;
  const canEnter = readiness.canEnter && !subjectMissing;
  const current = steps[step];

  const perform = async (key: string, context: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError(describeFriendlyError(failure, context));
    } finally {
      setBusyKey('');
    }
  };
  const refresh = async () => {
    const [nextStatus, nextPorts] = await Promise.all([getTriggerStatus(), listTriggerPorts()]);
    setStatus(nextStatus);
    setPorts(nextPorts);
    setPort(
      (currentPort) =>
        nextStatus.portName ||
        (nextPorts.some((item) => item.portName === currentPort)
          ? currentPort
          : // Never auto-pick a Bluetooth virtual port: on this lab machine COM3/COM4
            // are paired-earphone SPP ports that open but reject every write.
            nextPorts.find((item) => item.kind !== 'bluetooth')?.portName || ''),
    );
  };
  useEffect(() => {
    if (!desktop) return;
    let mounted = true;
    void Promise.all([getTriggerStatus(), listTriggerPorts()])
      .then(([nextStatus, nextPorts]) => {
        if (!mounted) return;
        setStatus(nextStatus);
        setPorts(nextPorts);
        setPort(
          nextStatus.portName ||
            nextPorts.find((item) => item.kind !== 'bluetooth')?.portName ||
            '',
        );
      })
      .catch((failure) => {
        if (mounted) setError(describeFriendlyError(failure, '读取触发盒状态'));
      });
    const storedLibrary = readStoredLibraryRootPath();
    if (storedLibrary)
      void loadParadigmVideoLibrary(storedLibrary)
        .then((loaded) => {
          if (mounted) {
            setValidatedLibrary(loaded.valid ? storedLibrary : '');
            setLibrarySummary(loaded.valid ? '已检查保存的素材库。' : '素材库需要重新验证。');
          }
        })
        .catch(() => {
          if (mounted) setLibrarySummary('素材库需要重新验证。');
        });
    return () => {
      mounted = false;
    };
  }, [desktop]);
  const savePreferences = (next: typeof preferences) => {
    try {
      writeExperimentPreferences(next);
      setPreferences(next);
    } catch (failure) {
      setError(describeFriendlyError(failure, '写入实验偏好'));
    }
  };
  const invalidateRecording = (mode = preferences.mode) => {
    savePreferences({
      ...preferences,
      mode,
      recordingPlanKey: undefined,
      expectedRecordingName: '',
      externalRecordingConfirmed: false,
    });
  };
  const updateEffectDraft = (patch: Partial<EffectPreparationDraft>) => {
    if (
      Object.entries(patch).some(
        ([key, value]) => effectDraft[key as keyof EffectPreparationDraft] !== value,
      )
    )
      invalidateRecording();
    setEffectDraft((current) => ({ ...current, ...patch }));
  };
  const copyPath = (test: boolean) =>
    perform('recordingPath', '准备保存路径', async () => {
      if (!plan.subjectId || !plan.userId) throw new Error('请先填写被试 ID。');
      const path = preparedPath || (await reserveRecordingPath(plan)).path;
      if (!preparedPath) {
        const next = {
          ...preferences,
          expectedRecordingName: path,
          recordingPlanKey: planKey,
          externalRecordingConfirmed: false,
        };
        writeExperimentPreferences(next);
        setPreferences(next);
      }
      const target = test ? triggerCheckPath(path) : path;
      try {
        await navigator.clipboard.writeText(target);
        setNotice('完整路径已复制。请在 ActiView 的 Start File 文件名栏中粘贴。');
      } catch {
        setNotice('请从上方路径框中复制完整路径，粘贴到 ActiView 的 Start File 文件名栏。');
      }
    });
  const busyClass = (key: string) => (busyKey === key ? styles.isBusy : '');
  const goToStep = (index: number) => {
    setStep(index);
    setNotice('');
    setError('');
  };
  const enterExperiment = () => {
    if (!canEnter || busy) return;
    if (destination === 'effect') {
      if (!prepareEffectHandoff(effectDraft)) {
        setError('未能交接本次配置。请检查当前评价是否已结束，然后重试。');
        return;
      }
      navigate('/effect-evaluation');
    } else {
      writeStoredSubjectId(plan.subjectId);
      setStage('paradigm');
    }
  };

  if (stage === 'paradigm')
    return (
      <section className={styles.workspace} aria-label="实验设置工作区">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>实验准备完成</p>
            <h1 className={styles.title}>逐试次范式</h1>
          </div>
          <span className={styles.statusPill}>
            {formal ? '准备模式：正式实验' : '准备模式：排练'}
          </span>
        </header>
        <p className={styles.lede}>
          个人校准使用平静视频；独立诱发使用三类情绪视频。音乐或视频调控的前后测请使用效果评价。
        </p>
        <p className={styles.environmentNotice}>
          开始前核对下方运行模式，以“正式 · 发送 Trigger”或“排练 · 不发送
          Trigger”为准。正式实验需保持 ActiView 的 Saving。
        </p>
        <ParadigmSessionPanel preparedSubjectId={plan.subjectId} preparedKind={paradigmKind} />
        <button
          type="button"
          className={`${styles.backButton} ${styles.ghostButton}`}
          onClick={() => {
            setStage('settings');
            goToStep(4);
            setPreferences(readExperimentPreferences());
            void refresh().catch((failure) =>
              setError(describeFriendlyError(failure, '读取触发盒状态')),
            );
          }}
        >
          返回实验设置
        </button>
      </section>
    );

  return (
    <section className={`${styles.workspace} ${guide.workspace}`} aria-label="实验设置工作区">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>实验准备 / BIOSEMI</p>
          <h1 className={styles.title}>实验设置</h1>
        </div>
        <div className={guide.headerStatus}>
          <span className={formal ? guide.formalMode : guide.rehearsalMode}>
            {formal ? '正式实验 · 发送 Trigger' : '排练 · 不发送流程标记'}
          </span>
          <span>
            {status.connected
              ? `触发盒已连接 · ${status.portName}${status.tested ? ' · 测试通过' : ' · 未测试'}`
              : '触发盒未连接'}
          </span>
        </div>
      </header>
      <p className={styles.lede}>按步骤准备。tauri-eeg 呈现刺激并打标，ActiView 单独保存脑电。</p>
      {!desktop && (
        <p className={styles.environmentNotice} role="status">
          浏览器预览无法访问串口，请在桌面应用中连接设备。
        </p>
      )}
      {status.activeRunId && (
        <p className={styles.environmentNotice} role="status">
          实验进行中，准备设置已锁定。请先完成或结束当前实验。
        </p>
      )}
      <div className={guide.layout}>
        <nav className={guide.steps} aria-label="实验准备步骤">
          {steps.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`${guide.stepButton} ${index === step ? guide.currentStep : ''}`}
              aria-current={index === step ? 'step' : undefined}
              disabled={busy}
              onClick={() => goToStep(index)}
            >
              <span className={guide.stepNumber}>{String(index + 1).padStart(2, '0')}</span>
              <span>{item.title}</span>
            </button>
          ))}
          <p className={guide.railNote}>
            每次实验都需重新确认 BDF 保存。实验模式只在当前窗口生效。
          </p>
        </nav>
        <div className={guide.content}>
          <section
            className={`${styles.section} ${guide.stepPanel}`}
            aria-labelledby="preparation-title"
          >
            <div className={guide.panelHeader}>
              <div>
                <p className={styles.eyebrow}>第 {step + 1} 步 / 共 5 步</p>
                <h2 id="preparation-title">{current.title}</h2>
              </div>
              <span className={guide.software}>{current.software}</span>
              {step < 4 && (
                <button
                  type="button"
                  disabled={busy}
                  className={guide.compactNext}
                  onClick={() => goToStep(step + 1)}
                >
                  继续：{steps[step + 1].title}
                </button>
              )}
            </div>
            {step === 0 && (
              <PreparationPlan
                {...{ destination, paradigmKind, effectDraft, updateEffectDraft, locked }}
                mode={preferences.mode}
                onMode={invalidateRecording}
                onKind={(kind) => {
                  invalidateRecording();
                  setParadigmKind(kind);
                }}
                onDestination={(next) => {
                  if (next !== destination) {
                    invalidateRecording();
                    setDestination(next);
                  }
                }}
              />
            )}
            {step === 1 && (
              <PreparationConnection
                {...{
                  formal,
                  locked,
                  desktop,
                  ports,
                  port,
                  status,
                  setPort,
                  setStatus,
                  refresh,
                  perform,
                  setNotice,
                  busyClass,
                  preparedPath,
                  subjectMissing,
                  copyPath,
                }}
              />
            )}
            {step === 2 && (
              <PreparationMaterials
                {...{
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
                }}
              />
            )}
            {step === 3 && (
              <>
                {formal ? (
                  <>
                    <RecordingPathControl
                      path={preparedPath}
                      disabled={locked || !desktop || subjectMissing}
                      onCopy={() => void copyPath(false)}
                    />
                    <p className={guide.introduction}>
                      在 ActiView 使用此路径开始保存。确认绿色 Saving，且 Total Saved [sec]
                      持续增加。
                    </p>
                    <label className={`${styles.check} ${guide.recordingCheck}`}>
                      <input
                        type="checkbox"
                        disabled={locked || !preparedPath}
                        checked={confirmed}
                        onChange={(event) =>
                          savePreferences({
                            ...preferences,
                            externalRecordingConfirmed: event.target.checked,
                          })
                        }
                      />
                      我已在 ActiView 启动本次 BDF 保存
                    </label>
                    <p className={styles.muted}>
                      更换被试或实验配置后，请使用新路径并重新确认保存。
                    </p>
                  </>
                ) : (
                  <>
                    <p className={guide.introduction}>
                      排练不要求 ActiView 保存，可以继续核对实验。
                    </p>
                    <p className={styles.muted}>
                      若想验证硬件入标，先在 ActiView 保存短 BDF，再回到“连接与测试”发送 254。
                    </p>
                  </>
                )}
              </>
            )}
            {step === 4 && (
              <PreparationReview
                {...{
                  destinationLabel,
                  destination,
                  paradigmKind,
                  effectDraft,
                  formal,
                  status,
                  validatedLibrary,
                  library,
                  confirmed,
                  preferences,
                  canEnter,
                  subjectMissing,
                  readiness,
                  goToStep,
                }}
              />
            )}
            {error && (
              <p className={styles.errorMessage} role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className={styles.resultBanner} role="status">
                {notice}
              </p>
            )}
            <footer className={guide.actions}>
              <button
                type="button"
                className={styles.ghostButton}
                disabled={busy || step === 0}
                onClick={() => goToStep(step - 1)}
              >
                上一步
              </button>
              {step < 4 ? (
                <button type="button" disabled={busy} onClick={() => goToStep(step + 1)}>
                  下一步：{steps[step + 1].title}
                </button>
              ) : (
                <button type="button" disabled={busy || !canEnter} onClick={enterExperiment}>
                  {destination === 'effect' ? '进入效果评价' : '进入逐试次范式'}
                </button>
              )}
            </footer>
          </section>
          <aside className={guide.companion} aria-label="当前操作提示">
            <span className={guide.software}>{current.software}</span>
            <h3>这一步怎么做</h3>
            <ol>
              {current.instructions.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ol>
            <p>尚未戴帽也可测试保存与打标。正式采集被试脑电前，再检查 CMS、DRL 和电极接触。</p>
          </aside>
        </div>
      </div>
      <details className={guide.afterExperiment}>
        <summary>实验结束后：关联 BDF 与导出日志</summary>
        <p>
          先在 ActiView 正常结束保存，再在对应记录中关联 BDF。中止码 91 不代表正常完成；正常结束码为
          61。
        </p>
        <ExperimentRunHistory />
      </details>
    </section>
  );
}
