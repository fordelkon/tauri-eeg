import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useNavigate } from 'react-router-dom';
import { connectTrigger, disconnectTrigger, getTriggerStatus, listTriggerPorts, testTrigger, type TriggerStatus } from '../../experiment/api';
import { readExperimentPreferences, writeExperimentPreferences } from '../../experiment/settings';
import { getPreparationReadiness, type ExperimentDestination, type PreparationStep } from '../../experiment/preparation';
import { loadParadigmVideoLibrary } from '../../paradigm/paradigmApi';
import { readStoredLibraryRootPath, writeStoredLibraryRootPath } from '../../paradigm/paradigmStorage';
import { isTauriAvailable } from '../../ui/tauriEnvironment';
import { describeFriendlyError } from '../../ui/friendlyError';
import ExperimentRunHistory from '../../experiment/ExperimentRunHistory';
import ParadigmSessionPanel from '../../paradigm/ParadigmSessionPanel';
import styles from './ExperimentSettings.module.css';
import guide from './ExperimentPreparation.module.css';

const emptyStatus: TriggerStatus = { connected: false, portName: null, activeRunId: null, lastError: null };
const steps = [
  { id: 'plan', title: '选择实验', software: 'tauri-eeg', instructions: ['先选择要运行的流程。效果评价与个人校准是不同实验。', '正式实验自动发送阶段标记；排练保留日志，但不发送流程标记。', '在同一个应用窗口完成准备和实验。新窗口默认排练。'] },
  { id: 'connection', title: '连接与测试', software: '两个软件配合', instructions: ['ActiView：点击 Start，确认采样率非零。点击 Start File 保存短测试 BDF。', 'tauri-eeg：连接触发盒，发送测试码 254。', 'ActiView / ActiRead：核对 254 确实进入文件。发送提示不能代替 BDF 检查。'] },
  { id: 'materials', title: '准备素材', software: 'tauri-eeg', instructions: ['选择包含诱发视频的素材库，验证后再继续。', '音乐效果评价：实验前先到音乐调控页生成曲目。', '个人校准使用平静视频；独立诱发使用焦虑、抑郁和恐惧视频。'] },
  { id: 'recording', title: '保存脑电', software: 'ActiView → tauri-eeg', instructions: ['ActiView：结束短测试，新建本次实验 BDF；每次使用不同文件名。', '确认绿色 Saving，并观察 Total Saved 秒数持续增加。', '切回这里填写相同的文件名，再确认本次保存。'] },
  { id: 'review', title: '核对并进入', software: 'tauri-eeg', instructions: ['核对下方的实验流程和模式，再进入实验页面填写被试与参数。', '实验运行时，tauri-eeg 自动打标，ActiView 持续保存。', '实验结束后在 ActiView 正常停止保存，再关联 BDF、导出日志。'] },
] satisfies { id: PreparationStep; title: string; software: string; instructions: string[] }[];

export default function ExperimentSettings() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<'settings' | 'paradigm'>('settings');
  const [step, setStep] = useState(0);
  const [destination, setDestination] = useState<ExperimentDestination>('effect');
  const [status, setStatus] = useState(emptyStatus);
  const [ports, setPorts] = useState<{ portName: string; description: string }[]>([]);
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
  const readiness = getPreparationReadiness({ mode: preferences.mode, desktop, connected: status.connected,
    libraryValidated: validatedLibrary !== '' && validatedLibrary === library.trim(),
    externalRecordingConfirmed: preferences.externalRecordingConfirmed, activeRunId: status.activeRunId });
  const current = steps[step];

  const perform = async (key: string, context: string, action: () => Promise<void>) => {
    setBusyKey(key); setError(''); setNotice('');
    try { await action(); } catch (failure) { setError(describeFriendlyError(failure, context)); }
    finally { setBusyKey(''); }
  };
  const refresh = async () => {
    const [nextStatus, nextPorts] = await Promise.all([getTriggerStatus(), listTriggerPorts()]);
    setStatus(nextStatus); setPorts(nextPorts);
    setPort(currentPort => nextStatus.portName || (nextPorts.some(item => item.portName === currentPort) ? currentPort : nextPorts[0]?.portName || ''));
  };
  useEffect(() => {
    if (!desktop) return;
    let mounted = true;
    void Promise.all([getTriggerStatus(), listTriggerPorts()]).then(([nextStatus, nextPorts]) => {
      if (!mounted) return;
      setStatus(nextStatus); setPorts(nextPorts); setPort(nextStatus.portName || nextPorts[0]?.portName || '');
    }).catch(failure => { if (mounted) setError(describeFriendlyError(failure, '读取触发盒状态')); });
    const storedLibrary = readStoredLibraryRootPath();
    if (storedLibrary) void loadParadigmVideoLibrary(storedLibrary).then(() => {
      if (mounted) { setValidatedLibrary(storedLibrary); setLibrarySummary('已检查保存的素材库。'); }
    }).catch(() => { if (mounted) setLibrarySummary('素材库需要重新验证。'); });
    return () => { mounted = false; };
  }, [desktop]);
  const savePreferences = (next: typeof preferences) => {
    try { writeExperimentPreferences(next); setPreferences(next); }
    catch (failure) { setError(describeFriendlyError(failure, '写入实验偏好')); }
  };
  const busyClass = (key: string) => busyKey === key ? styles.isBusy : '';
  const goToStep = (index: number) => { setStep(index); setNotice(''); setError(''); };
  const enterExperiment = () => {
    if (!readiness.canEnter || busy) return;
    if (destination === 'effect') navigate('/effect-evaluation');
    else setStage('paradigm');
  };

  if (stage === 'paradigm') return (
    <section className={styles.workspace} aria-label="实验设置工作区">
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>实验准备完成</p><h1 className={styles.title}>逐试次范式</h1></div>
        <span className={styles.statusPill}>{formal ? '准备模式：正式实验' : '准备模式：排练'}</span>
      </header>
      <p className={styles.lede}>个人校准使用平静视频；独立诱发使用三类情绪视频。音乐或视频调控的前后测请使用效果评价。</p>
      <p className={styles.environmentNotice}>开始前核对下方运行模式，以“正式 · 发送 Trigger”或“排练 · 不发送 Trigger”为准。正式实验需保持 ActiView 的 Saving。</p>
      <ParadigmSessionPanel />
      <button type="button" className={`${styles.backButton} ${styles.ghostButton}`} onClick={() => { setStage('settings'); goToStep(4); setPreferences(readExperimentPreferences()); void refresh().catch(failure => setError(describeFriendlyError(failure, '读取触发盒状态'))); }}>返回实验设置</button>
    </section>
  );

  return (
    <section className={`${styles.workspace} ${guide.workspace}`} aria-label="实验设置工作区">
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>实验准备 / BIOSEMI</p><h1 className={styles.title}>实验设置</h1></div>
        <div className={guide.headerStatus}>
          <span className={formal ? guide.formalMode : guide.rehearsalMode}>{formal ? '正式实验 · 发送 Trigger' : '排练 · 不发送流程标记'}</span>
          <span>{status.connected ? `触发盒已连接 · ${status.portName}` : '触发盒未连接'}</span>
        </div>
      </header>
      <p className={styles.lede}>按步骤准备。tauri-eeg 呈现刺激并打标，ActiView 单独保存脑电。</p>
      {!desktop && <p className={styles.environmentNotice} role="status">浏览器预览无法访问串口，请在桌面应用中连接设备。</p>}
      {status.activeRunId && <p className={styles.environmentNotice} role="status">实验进行中，准备设置已锁定。请先完成或结束当前实验。</p>}
      <div className={guide.layout}>
        <nav className={guide.steps} aria-label="实验准备步骤">
          {steps.map((item, index) => <button key={item.id} type="button" className={`${guide.stepButton} ${index === step ? guide.currentStep : ''}`}
            aria-current={index === step ? 'step' : undefined} disabled={busy} onClick={() => goToStep(index)}>
            <span className={guide.stepNumber}>{String(index + 1).padStart(2, '0')}</span><span>{item.title}</span>
          </button>)}
          <p className={guide.railNote}>每次实验都需重新确认 BDF 保存。实验模式只在当前窗口生效。</p>
        </nav>
        <div className={guide.content}>
          <section className={`${styles.section} ${guide.stepPanel}`} aria-labelledby="preparation-title">
            <div className={guide.panelHeader}><div><p className={styles.eyebrow}>第 {step + 1} 步 / 共 5 步</p><h2 id="preparation-title">{current.title}</h2></div><span className={guide.software}>{current.software}</span>
              {step < 4 && <button type="button" disabled={busy} className={guide.compactNext} onClick={() => goToStep(step + 1)}>继续：{steps[step + 1].title}</button>}
            </div>
            {step === 0 && <>
              <p className={guide.introduction}>这次要运行哪个流程？选择后，最后一步会进入对应页面。</p>
              <div className={guide.choices} role="group" aria-label="实验流程">
                <button type="button" aria-pressed={destination === 'effect'} disabled={locked} className={guide.choice} onClick={() => setDestination('effect')}>
                  <strong>效果评价</strong><span>诱发 → 前测 → 音乐、视频调控或自然恢复 → 后测</span>
                </button>
                <button type="button" aria-pressed={destination === 'paradigm'} disabled={locked} className={guide.choice} onClick={() => setDestination('paradigm')}>
                  <strong>逐试次范式</strong><span>个人校准或独立诱发：静息 → 提示 → 视频 → SAM</span>
                </button>
              </div>
              <label className={guide.modeField}>模式<select aria-label="模式" disabled={locked} value={preferences.mode} onChange={event => savePreferences({ ...preferences,
                mode: event.target.value === 'formal' ? 'formal' : 'rehearsal', externalRecordingConfirmed: false })}>
                <option value="rehearsal">排练 · 不发送硬件 Trigger</option><option value="formal">正式实验 · 发送 Trigger</option>
              </select></label>
              <p className={styles.muted}>{formal ? '将实际发送事件到 BioSemi，开始前需要连接触发盒并确认 BDF 保存。' : '用于熟悉操作。保存实验日志和量表，不发送流程 Trigger。'}</p>
            </>}
            {step === 1 && <>
              <h3 className={guide.subheading}>Trigger 接口</h3>
              <p className={guide.introduction}>{formal ? '先连接触发盒，再用短 BDF 检查测试码。' : '排练可跳过设备连接。需要测试硬件时，仍可连接并发送 254。'}</p>
              <div className={styles.row}>
                <label>COM 端口<select aria-label="COM 端口" value={port} disabled={locked || status.connected} onChange={event => setPort(event.target.value)}>
                  <option value="">选择端口</option>{ports.map(item => <option key={item.portName} value={item.portName}>{item.portName} {item.description}</option>)}
                </select></label>
                <button type="button" disabled={locked || !desktop} className={`${styles.ghostButton} ${busyClass('refresh')}`} onClick={() => void perform('refresh', '读取触发盒状态', refresh)}>刷新端口</button>
                <button type="button" disabled={locked || !desktop || (!status.connected && !port)} className={busyClass('connect')} onClick={() => void perform('connect', '连接触发盒', async () => {
                  setStatus(status.connected ? await disconnectTrigger() : await connectTrigger(port));
                })}>{status.connected ? '断开触发盒' : '连接触发盒'}</button>
              </div>
              <button type="button" disabled={locked || !status.connected} className={`${styles.ghostButton} ${busyClass('test')}`} onClick={() => void perform('test', '发送测试 Trigger', async () => {
                setStatus(await testTrigger()); setNotice('测试码 254 已写入串口。请在 ActiView 和短 BDF 中确认标记。');
              })}>发送测试 Trigger</button>
              <p className={styles.muted}>只保留一个 tauri-eeg 窗口。串口写入成功不代表 BDF 已收到标记。</p>
              {status.lastError && <p className={styles.errorMessage}>{status.lastError}</p>}
            </>}
            {step === 2 && <>
              <p className={guide.introduction}>选择诱发与视频调控素材库。已有素材库会自动检查，无需每次重新选择。</p>
              <label>素材库根目录<input disabled={locked} value={library} onChange={event => { setLibrary(event.target.value); setValidatedLibrary(''); setLibrarySummary(''); }} /></label>
              <div className={styles.row}>
                <button type="button" disabled={locked || !desktop} className={`${styles.ghostButton} ${busyClass('pickFolder')}`} onClick={() => void perform('pickFolder', '选择素材库目录', async () => {
                  const chosen = await open({ directory: true, multiple: false, title: '选择范式素材库' });
                  if (typeof chosen === 'string') { setLibrary(chosen); setValidatedLibrary(''); setLibrarySummary(''); }
                })}>选择文件夹</button>
                <button type="button" disabled={locked || !desktop || !library.trim()} className={busyClass('validateLibrary')} onClick={() => void perform('validateLibrary', '验证素材库', async () => {
                  const loaded = await loadParadigmVideoLibrary(library.trim()); writeStoredLibraryRootPath(library.trim()); setValidatedLibrary(library.trim());
                  setLibrarySummary(`素材库已验证：焦虑 ${loaded.anxiety.length}、抑郁 ${loaded.depression.length}、恐惧 ${loaded.fear.length}、平静 ${loaded.calm.length}。`);
                })}>验证并保存素材库</button>
              </div>
              {librarySummary && <p className={styles.muted} role="status">{librarySummary}</p>}
              {destination === 'effect' && <p className={styles.muted}>音乐曲目需提前在音乐调控页准备；本页验证的是视频素材。</p>}
            </>}
            {step === 3 && <>
              {formal ? <>
                <p className={guide.introduction}>现在切换到 ActiView：选择 Save Subset，点击 Start File，新建本次实验文件。</p>
                <ol className={guide.instructions}><li>确认右上角为绿色 Saving。</li><li>确认 Total Saved [sec] 持续增加。</li><li>切回这里填写记录名并确认保存。</li></ol>
                <label>BDF 记录名<input disabled={locked} value={preferences.expectedRecordingName} placeholder="例如 sub01_effect_run01.bdf" onChange={event => savePreferences({ ...preferences,
                  expectedRecordingName: event.target.value, externalRecordingConfirmed: false })} /></label>
                <label className={`${styles.check} ${guide.recordingCheck}`}><input type="checkbox" disabled={locked} checked={preferences.externalRecordingConfirmed}
                  onChange={event => savePreferences({ ...preferences, externalRecordingConfirmed: event.target.checked })} />我已在 ActiView 启动本次 BDF 保存</label>
                <p className={styles.muted}>这由你确认，应用无法读取 ActiView 的保存状态。修改记录名后需重新确认。</p>
              </> : <>
                <p className={guide.introduction}>排练不要求 ActiView 保存，可以继续核对实验。</p>
                <p className={styles.muted}>若想验证硬件入标，先在 ActiView 保存短 BDF，再回到“连接与测试”发送 254。</p>
              </>}
            </>}
            {step === 4 && <>
              <p className={guide.introduction}>即将进入的是 <strong>{destinationLabel}</strong>。请核对，避免把个人校准当作效果评价。</p>
              <dl className={guide.review}>
                <div><dt>实验流程</dt><dd>{destinationLabel}</dd></div>
                <div><dt>运行模式</dt><dd>{formal ? '正式实验 · 发送 Trigger' : '排练 · 不发送流程标记'}</dd></div>
                <div><dt>触发盒</dt><dd>{status.connected ? `已连接 · ${status.portName}` : formal ? '尚未连接' : '排练无需连接'}</dd></div>
                <div><dt>视频素材</dt><dd>{validatedLibrary === library.trim() && validatedLibrary ? '已验证' : '需要验证'}</dd></div>
                <div><dt>BDF 保存</dt><dd>{formal ? preferences.externalRecordingConfirmed ? `操作者已确认 · ${preferences.expectedRecordingName || '未填写记录名'}` : '尚未确认' : '排练无需保存'}</dd></div>
              </dl>
              {!readiness.canEnter && <div className={guide.blockers} role="status"><strong>还需要完成</strong><ul>{readiness.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
              <p className={styles.muted}>进入页面后再填写被试和参数，点击开始才创建实验记录。</p>
            </>}
            {error && <p className={styles.errorMessage} role="alert">{error}</p>}
            {notice && <p className={styles.resultBanner} role="status">{notice}</p>}
            <footer className={guide.actions}>
              <button type="button" className={styles.ghostButton} disabled={busy || step === 0} onClick={() => goToStep(step - 1)}>上一步</button>
              {step < 4 ? <button type="button" disabled={busy} onClick={() => goToStep(step + 1)}>下一步：{steps[step + 1].title}</button>
                : <button type="button" disabled={busy || !readiness.canEnter} onClick={enterExperiment}>{destination === 'effect' ? '进入效果评价' : '进入逐试次范式'}</button>}
            </footer>
          </section>
          <aside className={guide.companion} aria-label="当前操作提示"><span className={guide.software}>{current.software}</span><h3>这一步怎么做</h3>
            <ol>{current.instructions.map(text => <li key={text}>{text}</li>)}</ol>
            <p>尚未戴帽也可测试保存与打标。正式采集被试脑电前，再检查 CMS、DRL 和电极接触。</p>
          </aside>
        </div>
      </div>
      <details className={guide.afterExperiment}><summary>实验结束后：关联 BDF 与导出日志</summary>
        <p>先在 ActiView 正常结束保存，再在对应记录中关联 BDF。中止码 91 不代表正常完成；正常结束码为 61。</p>
        <ExperimentRunHistory />
      </details>
    </section>
  );
}
