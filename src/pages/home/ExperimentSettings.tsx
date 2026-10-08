import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Link } from 'react-router-dom';
import {
  connectTrigger, disconnectTrigger, getTriggerStatus, listTriggerPorts, testTrigger,
  type TriggerStatus,
} from '../../experiment/api';
import { readExperimentPreferences, writeExperimentPreferences } from '../../experiment/settings';
import { loadParadigmVideoLibrary } from '../../paradigm/paradigmApi';
import { readStoredLibraryRootPath, writeStoredLibraryRootPath } from '../../paradigm/paradigmStorage';
import { isTauriAvailable } from '../../ui/tauriEnvironment';
import { describeFriendlyError } from '../../ui/friendlyError';
import ExperimentRunHistory from '../../experiment/ExperimentRunHistory';
import ParadigmSessionPanel from '../../paradigm/ParadigmSessionPanel';
import styles from './ExperimentSettings.module.css';

const emptyStatus: TriggerStatus = { connected: false, portName: null, activeRunId: null, lastError: null };

export default function ExperimentSettings() {
  const [stage, setStage] = useState<'settings' | 'paradigm'>('settings');
  const [status, setStatus] = useState(emptyStatus);
  const [ports, setPorts] = useState<{ portName: string; description: string }[]>([]);
  const [port, setPort] = useState('');
  const [preferences, setPreferences] = useState(readExperimentPreferences);
  const [library, setLibrary] = useState(readStoredLibraryRootPath);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const busy = busyKey !== '';
  const desktop = isTauriAvailable();

  const perform = async (key: string, context: string, action: () => Promise<void>) => {
    setBusyKey(key); setError(''); setNotice('');
    try { await action(); } catch (failure) { setError(describeFriendlyError(failure, context)); }
    finally { setBusyKey(''); }
  };
  const busySuffix = (key: string) => busyKey === key ? ` ${styles.isBusy}` : '';
  const busyOnly = (key: string) => busyKey === key ? styles.isBusy : undefined;
  const refresh = async () => {
    const [nextStatus, nextPorts] = await Promise.all([getTriggerStatus(), listTriggerPorts()]);
    setStatus(nextStatus); setPorts(nextPorts);
    setPort((current) => current || nextStatus.portName || nextPorts[0]?.portName || '');
  };
  useEffect(() => {
    if (!desktop) return;
    let mounted = true;
    void refresh().catch((failure) => { if (mounted) setError(describeFriendlyError(failure, '读取触发盒状态')); });
    return () => { mounted = false; };
  }, [desktop]);
  const savePreferences = (next: typeof preferences) => {
    try { writeExperimentPreferences(next); setPreferences(next); }
    catch (failure) { setError(describeFriendlyError(failure, '写入实验偏好')); }
  };
  const locked = busy || Boolean(status.activeRunId);
  const scrollWorkspaceTop = () => document.getElementById('workspace-content')?.scrollTo({ top: 0, behavior: 'smooth' });

  if (stage === 'paradigm') {
    return (
      <section className={styles.workspace} aria-label="实验设置工作区">
        <div key="paradigm" className={styles.stageSwap}>
          <header className={styles.header}>
            <div>
              <p className={styles.eyebrow}>BIOSEMI / STEP 02</p>
              <h1 className={styles.title}>逐试次范式</h1>
            </div>
          </header>
          <p className={styles.lede}>确认实验队列后开始个人校准或独立情绪诱发。ActiView 继续保存 BDF。</p>
          <div className={styles.stepRail} aria-label="实验向导进度">
            <span className={styles.stepDone}>01 设置完成</span><span className={styles.stepCurrent}>02 逐试次范式</span>
          </div>
          <ParadigmSessionPanel />
          <button type="button" className={`${styles.backButton} ${styles.ghostButton}`} disabled={busy}
            onClick={() => { setStage('settings'); scrollWorkspaceTop(); }}>
            ← 返回实验设置
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.workspace} aria-label="实验设置工作区">
      <div key="settings" className={styles.stageSwap}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>BIOSEMI / EXTERNAL RECORDING</p>
            <h1 className={styles.title}>实验设置</h1>
          </div>
          <div className={styles.statusBar}>
            <span className={`${styles.statusPill} ${status.connected ? styles.streaming : styles.disconnected}`}>
              触发盒 {status.connected ? `已连接 · ${status.portName}` : '未连接'}
            </span>
          </div>
        </header>
        <p className={styles.lede}>本应用发送 Trigger 并保存实验日志。脑电由 ActiView 连续保存为 BDF。</p>
        {!desktop && <p className={styles.environmentNotice} role="status">浏览器预览无法访问串口，请在桌面应用中连接设备。</p>}
        {error && <p className={styles.errorMessage} role="alert">{error}</p>}
        {notice && <p className={styles.resultBanner} role="status">{notice}</p>}
        {status.activeRunId && <p className={styles.environmentNotice} role="status">实验 {status.activeRunId} 进行中，设备配置已锁定。</p>}
        <section className={styles.section}>
          <div className={styles.sectionHeader}><span className={styles.sectionIndex}>01</span><div><h2>Trigger 接口</h2><p className={styles.sectionLead}>连接触发盒，先用短 BDF 验证标记。</p></div></div>
          <p className={styles.muted}>BioSemi USB Trigger Interface · 115200 · 8N1 · 无流控</p>
          <div className={styles.row}>
            <label>COM 端口<select aria-label="COM 端口" value={port} disabled={locked || status.connected} onChange={(event) => setPort(event.target.value)}>
              <option value="">选择端口</option>
              {ports.map((item) => <option key={item.portName} value={item.portName}>{item.portName} {item.description}</option>)}
            </select></label>
            <button disabled={locked || !desktop} className={`${styles.ghostButton}${busySuffix('refresh')}`}
              onClick={() => void perform('refresh', '读取触发盒状态', refresh)}>刷新端口</button>
            {status.connected
              ? <button disabled={locked} className={busyOnly('connect')}
                  onClick={() => void perform('connect', '断开触发盒', async () => { setStatus(await disconnectTrigger()); })}>断开</button>
              : <button disabled={locked || !port || !desktop} className={busyOnly('connect')}
                  onClick={() => void perform('connect', '连接触发盒', async () => { setStatus(await connectTrigger(port)); })}>连接触发盒</button>}
            <button disabled={locked || !status.connected} className={busyOnly('test')}
              onClick={() => void perform('test', '发送测试 Trigger', async () => {
                setStatus(await testTrigger()); setNotice('测试码 254 已写入串口。请在 ActiView 和短 BDF 中确认标记。');
              })}>发送测试 Trigger</button>
          </div>
          {status.lastError && <p className={styles.errorMessage}>{status.lastError}</p>}
          <p className={styles.muted}>串口写入成功不代表 BDF 已收到标记。正式使用前保存短 BDF 检查。</p>
        </section>
        <section className={styles.section}>
          <div className={styles.sectionHeader}><span className={styles.sectionIndex}>02</span><div><h2>实验模式与外部录制</h2><p className={styles.sectionLead}>正式实验由 ActiView 负责连续保存。</p></div></div>
          <div className={styles.row}>
            <label>模式<select aria-label="模式" disabled={locked} value={preferences.mode} onChange={(event) => savePreferences({
              ...preferences, mode: event.target.value === 'formal' ? 'formal' : 'rehearsal', externalRecordingConfirmed: false,
            })}><option value="rehearsal">排练 · 不发送硬件 Trigger</option><option value="formal">正式实验 · 发送 Trigger</option></select></label>
            <label>BDF 记录名<input disabled={locked} value={preferences.expectedRecordingName}
              placeholder="例如 sub01_music_run01.bdf" onChange={(event) => savePreferences({ ...preferences, expectedRecordingName: event.target.value })} /></label>
          </div>
          <label className={styles.check}><input type="checkbox" disabled={locked || preferences.mode !== 'formal'}
            checked={preferences.externalRecordingConfirmed} onChange={(event) => savePreferences({ ...preferences, externalRecordingConfirmed: event.target.checked })} />
            我已在 ActiView 启动本次 BDF 保存
          </label>
          <p className={styles.muted}>该确认来自操作者，每次正式实验都需重新确认。本应用不控制 ActiView 的保存按钮。</p>
        </section>
        <section className={styles.section}>
          <div className={styles.sectionHeader}><span className={styles.sectionIndex}>03</span><div><h2>诱发与视频调控素材</h2><p className={styles.sectionLead}>同一素材库服务诱发、校准与视频调控。</p></div></div>
          <label>素材库根目录<input disabled={locked} value={library} onChange={(event) => setLibrary(event.target.value)} /></label>
          <div className={styles.row}>
            <button disabled={locked || !desktop} className={`${styles.ghostButton}${busySuffix('pickFolder')}`}
              onClick={() => void perform('pickFolder', '选择素材库目录', async () => {
                const chosen = await open({ directory: true, multiple: false, title: '选择范式素材库' });
                if (typeof chosen === 'string') setLibrary(chosen);
              })}>选择文件夹</button>
            <button disabled={locked || !desktop || !library.trim()} className={busyOnly('validateLibrary')}
              onClick={() => void perform('validateLibrary', '验证素材库', async () => {
                const loaded = await loadParadigmVideoLibrary(library.trim());
                writeStoredLibraryRootPath(library.trim());
                setNotice(`素材库已验证：焦虑 ${loaded.anxiety.length}、抑郁 ${loaded.depression.length}、恐惧 ${loaded.fear.length}、平静 ${loaded.calm.length}。`);
              })}>验证并保存素材库</button>
          </div>
          <p className={styles.muted}>沿用原有素材路径与类别规则。平静素材用于个人校准和视频调控。</p>
        </section>
        <nav className={`${styles.row} ${styles.pageNav}`}>
          <button type="button" className={styles.nextStepButton} disabled={busy}
            onClick={() => { setStage('paradigm'); scrollWorkspaceTop(); }}>
            下一步：逐试次范式 <span aria-hidden="true">↗</span>
          </button>
          <Link to="/effect-evaluation">进入音乐或视频效果评价 <span aria-hidden="true">↗</span></Link>
        </nav>
        <ExperimentRunHistory />
      </div>
    </section>
  );
}
