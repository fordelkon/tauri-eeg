import ActivityRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import EegChannelList from '../../eeg/EegChannelList';
import EegControls from '../../eeg/EegControls';
import EegWaveformPanel from '../../eeg/EegWaveformPanel';
import { useRealtimeEeg } from '../../eeg/useRealtimeEeg';
import styles from './EegAcquisition.module.css';

export default function EegAcquisition() {
  const eeg = useRealtimeEeg();
  const visibleCount = eeg.settings.visibleChannelIds.size;
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
  const deviceStatusLabel = deviceStatusLabels[eeg.deviceStatus];
  const recordStatusLabel = recordStatusLabels[eeg.recordStatus];

  return (
    <section className={`${styles.workspace} mx-auto flex w-full min-h-0 flex-col`} aria-label="EEG采集工作区">
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
          <span>{eeg.sampleRateHz} Hz</span>
          <span>{visibleCount}/{eeg.channels.length} 通道</span>
        </div>
      </header>

      <EegControls
        amplitudeUvPerDiv={eeg.settings.amplitudeUvPerDiv}
        canPauseRecord={eeg.canPauseRecord}
        canResumeRecord={eeg.canResumeRecord}
        canStartDevice={eeg.canStartDevice}
        canStartRecord={eeg.canStartRecord}
        canStopDevice={eeg.canStopDevice}
        canStopRecord={eeg.canStopRecord}
        deviceStatus={eeg.deviceStatus}
        timeWindowSeconds={eeg.settings.timeWindowSeconds}
        onAmplitudeChange={eeg.setAmplitudeUvPerDiv}
        onPauseRecord={eeg.pauseRecord}
        onReset={eeg.reset}
        onResumeRecord={eeg.resumeRecord}
        onStartDevice={eeg.startDevice}
        onStartRecord={eeg.startRecord}
        onStopDevice={eeg.stopDevice}
        onStopRecord={eeg.stopRecord}
        onTimeWindowChange={eeg.setTimeWindowSeconds}
      />

      {eeg.errorMessage ? <div className={styles.errorMessage}>{eeg.errorMessage}</div> : null}

      <div className={styles.monitorGrid}>
        <EegChannelList
          channels={eeg.channels}
          visibleChannelIds={eeg.settings.visibleChannelIds}
          onToggleChannel={eeg.toggleChannel}
        />
        <EegWaveformPanel
          amplitudeUvPerDiv={eeg.settings.amplitudeUvPerDiv}
          snapshot={eeg.snapshot}
          timeWindowSeconds={eeg.settings.timeWindowSeconds}
        />
      </div>

      <footer className={`${styles.footer} flex flex-wrap`}>
        <span>窗口 {eeg.settings.timeWindowSeconds}s</span>
        <span>幅度 {eeg.settings.amplitudeUvPerDiv} uV/div</span>
        <span>缓存 {eeg.snapshot.retainedSampleCount} 样本</span>
        <span>序列 {eeg.snapshot.latestSequence ?? '-'}</span>
      </footer>
    </section>
  );
}
