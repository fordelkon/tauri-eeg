import ActivityRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import EegChannelList from '../../eeg/EegChannelList';
import EegControls from '../../eeg/EegControls';
import EegWaveformPanel from '../../eeg/EegWaveformPanel';
import { useEegSession } from '../../eeg/EegSessionContext';
import {
  formatRecordingClock,
  resolvedRecordingDurationSeconds,
} from '../../eeg/recordingClock';
import { useRealtimeEeg } from '../../eeg/useRealtimeEeg';
import ParadigmSessionPanel from '../../eeg/paradigm/ParadigmSessionPanel';
import { useParadigmSessionStatus } from '../../eeg/paradigm/paradigmSessionStatus';
import styles from './EegAcquisition.module.css';

const deviceStatusLabels = {
  disconnected: '未连接',
  error: '异常',
  starting: '等待脑电设备',
  stopping: '停止中',
  streaming: '采集中',
} as const;
const recordStatusLabels = {
  idle: '空闲',
  paused: '已暂停',
  recording: '记录中',
  stopped: '已停止',
} as const;

/**
 * Owns the 30Hz snapshot state so only this subtree re-renders per frame; the
 * controls strip and (thanks to React.memo) the channel checkboxes are skipped.
 */
function RealtimeMonitor() {
  const eeg = useRealtimeEeg();

  return (
    <>
      <div className={styles.monitorGrid}>
        <EegChannelList
          channels={eeg.channels}
          visibleChannelIds={eeg.settings.visibleChannelIds}
          onToggleChannel={eeg.toggleChannel}
        />
        <EegWaveformPanel
          amplitudeUvPerDiv={eeg.settings.amplitudeUvPerDiv}
          displayMode={eeg.settings.displayMode}
          onPlotWidthChange={eeg.reportPlotWidthPx}
          snapshot={eeg.snapshot}
          timeWindowSeconds={eeg.settings.timeWindowSeconds}
        />
      </div>
      <footer className={`${styles.footer} flex flex-wrap`}>
        <span>刷新 {eeg.settings.displayMode === 'sweep' ? '扫描' : '滚动'}</span>
        <span>窗口 {eeg.settings.timeWindowSeconds}s</span>
        <span>幅度 {eeg.settings.amplitudeUvPerDiv} uV/div</span>
        <span>缓存 {eeg.snapshot.retainedSampleCount} 样本</span>
        <span>序列 {eeg.snapshot.latestSequence ?? '-'}</span>
      </footer>
    </>
  );
}

type AcquisitionMode = 'free' | 'paradigm';

const modeLabels: Record<AcquisitionMode, string> = {
  free: '自由采集',
  paradigm: '范式采集',
};

export default function EegAcquisition() {
  const eeg = useEegSession();
  const { currentUser } = useAuth();
  const paradigmStatus = useParadigmSessionStatus();
  const [selectedMode, setSelectedMode] = useState<AcquisitionMode>('free');
  // A running paradigm session pins the page to the paradigm view so the free
  // acquisition controls cannot interfere with the trials.
  const mode: AcquisitionMode = paradigmStatus.active ? 'paradigm' : selectedMode;
  const visibleCount = eeg.settings.visibleChannelIds.size;
  const deviceStatusLabel = deviceStatusLabels[eeg.deviceStatus];
  const recordStatusLabel = recordStatusLabels[eeg.recordStatus];

  // Wall clock since startRecord succeeded; pause keeps the anchor so 继续
  // 记录 resumes the same timer, and idle/stopped clears it for the next run.
  const [recordingStartedAtMs, setRecordingStartedAtMs] = useState<number | null>(null);
  const [, setTimerTick] = useState(0);

  useEffect(() => {
    if (eeg.recordStatus === 'recording') {
      // Keep an existing anchor so re-runs (StrictMode, resume) don't reset it.
      setRecordingStartedAtMs((current) => current ?? Date.now());
      return;
    }

    if (eeg.recordStatus !== 'paused') {
      setRecordingStartedAtMs(null);
    }
  }, [eeg.recordStatus]);

  useEffect(() => {
    if (eeg.recordStatus !== 'recording') {
      return undefined;
    }

    // The tick only forces re-renders; the elapsed value reads Date.now().
    const interval = window.setInterval(() => setTimerTick((tick) => tick + 1), 1000);

    return () => window.clearInterval(interval);
  }, [eeg.recordStatus]);

  const recordedSeconds = recordingStartedAtMs !== null
    ? Math.max(0, Math.floor((Date.now() - recordingStartedAtMs) / 1000))
    : 0;

  const lastRecordingDurationSeconds = eeg.lastRecording
    ? resolvedRecordingDurationSeconds(eeg.lastRecording)
    : null;

  // 停止设备 while a recording is active would make the backend halt+persist
  // silently and the frontend drop the result banner; ask first, then route
  // through stopRecord so the save path (stopped + lastRecording) completes
  // before the stream is halted.
  const [isStopDeviceConfirmOpen, setIsStopDeviceConfirmOpen] = useState(false);
  const [isStopDeviceSaving, setIsStopDeviceSaving] = useState(false);

  const handleStopDevice = () => {
    if (eeg.recordStatus === 'recording' || eeg.recordStatus === 'paused') {
      if (!isStopDeviceSaving) {
        setIsStopDeviceConfirmOpen(true);
      }
      return;
    }

    void eeg.stopDevice();
  };

  const handleConfirmedStopDevice = () => {
    setIsStopDeviceConfirmOpen(false);

    // Save through the normal path first and only halt the stream once the
    // recording actually landed, so the result banner still appears. A failed
    // save aborts the shutdown — stopRecord has already surfaced its mapped
    // Chinese error through eeg.errorMessage.
    setIsStopDeviceSaving(true);
    void (async () => {
      try {
        const saved = await eeg.stopRecord();
        if (saved) {
          await eeg.stopDevice();
        }
      } finally {
        setIsStopDeviceSaving(false);
      }
    })();
  };

  return (
    <section
      className={`${styles.workspace} ${mode === 'paradigm' ? styles.paradigmWorkspace : ''} mx-auto flex w-full min-h-0 flex-col`}
      aria-label="EEG采集工作区"
    >
      <header className={`${styles.header} flex items-start justify-between`}>
        <div>
          <div className={styles.eyebrow}>采集监测</div>
          <h1 className={styles.title}>实时脑电</h1>
        </div>
        <div className={`${styles.statusBar} flex flex-wrap items-center justify-end`}>
          <span className={`${styles.statusPill} inline-flex items-center ${styles[eeg.deviceStatus]}`}>
            <ActivityRoundedIcon fontSize="small" />
            设备 {deviceStatusLabel}
          </span>
          <span className={`${styles.statusPill} inline-flex items-center ${styles[eeg.recordStatus]}`}>
            记录 {recordStatusLabel}
          </span>
          {eeg.recordStatus === 'recording' ? (
            <span>已录 {formatRecordingClock(recordedSeconds)} · {currentUser?.username ?? '未登录'}</span>
          ) : null}
          <span>{eeg.sampleRateHz} Hz</span>
          <span>{visibleCount}/{eeg.channels.length} 通道</span>
        </div>
      </header>

      <div className={styles.modeSwitch} role="tablist" aria-label="采集模式切换">
        {(['free', 'paradigm'] as const).map((candidate) => {
          const isActive = mode === candidate;

          return (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`${styles.modeSwitchButton} ${isActive ? styles.activeModeSwitchButton : ''}`}
              disabled={paradigmStatus.active}
              onClick={() => setSelectedMode(candidate)}
            >
              {modeLabels[candidate]}
            </button>
          );
        })}
        {paradigmStatus.active ? (
          <span className={styles.modeLockHint}>
            范式 Session 进行中(试次 {paradigmStatus.trialIndex}/{paradigmStatus.totalTrials}),已锁定导航与设备控制
          </span>
        ) : null}
      </div>

      {mode === 'free' ? (
        <>
          <EegControls
            amplitudeUvPerDiv={eeg.settings.amplitudeUvPerDiv}
            canPauseRecord={eeg.canPauseRecord}
            canResumeRecord={eeg.canResumeRecord}
            canStartDevice={eeg.canStartDevice}
            canStartRecord={eeg.canStartRecord}
            canStopDevice={eeg.canStopDevice}
            canStopRecord={eeg.canStopRecord}
            deviceStatus={eeg.deviceStatus}
            displayMode={eeg.settings.displayMode}
            timeWindowSeconds={eeg.settings.timeWindowSeconds}
            onAmplitudeChange={eeg.setAmplitudeUvPerDiv}
            onDisplayModeChange={eeg.setDisplayMode}
            onPauseRecord={eeg.pauseRecord}
            onReset={eeg.resetBuffer}
            onResumeRecord={eeg.resumeRecord}
            onStartDevice={eeg.startDevice}
            onStartRecord={eeg.startRecord}
            onStopDevice={handleStopDevice}
            onStopRecord={eeg.stopRecord}
            onTimeWindowChange={eeg.setTimeWindowSeconds}
          />

          {eeg.errorMessage ? <div className={styles.errorMessage}>{eeg.errorMessage}</div> : null}

          {/* Result of the just-stopped recording; disappears when the next
              recording starts (recordStatus leaves 'stopped'). */}
          {eeg.recordStatus === 'stopped' && eeg.lastRecording ? (
            <div className={styles.resultBanner} role="status" aria-label="记录保存结果">
              <span>记录已保存</span>
              <span>Session {eeg.lastRecording.id}</span>
              <span className={styles.resultBannerPath}>{eeg.lastRecording.sessionDir}</span>
              <span>
                时长 {lastRecordingDurationSeconds === null
                  ? '未知'
                  : formatRecordingClock(lastRecordingDurationSeconds)}
              </span>
            </div>
          ) : null}

          <RealtimeMonitor />

          <Dialog
            open={isStopDeviceConfirmOpen}
            onClose={() => setIsStopDeviceConfirmOpen(false)}
            aria-labelledby="stop-device-confirm-title"
          >
            <DialogTitle id="stop-device-confirm-title">停止设备前先结束记录?</DialogTitle>
            <DialogContent>
              <DialogContentText>
                当前 EEG 记录尚未停止。确认后将停止并保存本次记录,然后关闭脑电设备。
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setIsStopDeviceConfirmOpen(false)}>继续记录</Button>
              <Button color="error" onClick={handleConfirmedStopDevice}>停止并保存后关闭设备</Button>
            </DialogActions>
          </Dialog>
        </>
      ) : (
        /* Signal quality is checked in free mode; the paradigm panel only
           carries its own readiness dots. */
        <ParadigmSessionPanel />
      )}
    </section>
  );
}
