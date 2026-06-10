import ActivityRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import EegChannelList from '../../eeg/EegChannelList';
import EegControls from '../../eeg/EegControls';
import EegWaveformPanel from '../../eeg/EegWaveformPanel';
import { useRealtimeEeg } from '../../eeg/useRealtimeEeg';
import styles from './EegAcquisition.module.css';

export default function EegAcquisition() {
  const eeg = useRealtimeEeg();
  const visibleCount = eeg.settings.visibleChannelIds.size;

  return (
    <section className={styles.workspace} aria-label="EEG acquisition workspace">
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Acquisition Monitor</div>
          <h1 className={styles.title}>Realtime EEG</h1>
        </div>
        <div className={styles.statusBar}>
          <span className={`${styles.statusPill} ${styles[eeg.deviceStatus]}`}>
            <ActivityRoundedIcon fontSize="small" />
            Device {eeg.deviceStatus}
          </span>
          <span className={`${styles.statusPill} ${styles[eeg.recordStatus]}`}>
            Record {eeg.recordStatus}
          </span>
          <span>{eeg.sampleRateHz} Hz</span>
          <span>{visibleCount}/{eeg.channels.length} channels</span>
        </div>
      </header>

      <EegControls
        amplitudeUvPerDiv={eeg.settings.amplitudeUvPerDiv}
        canPauseRecord={eeg.canPauseRecord}
        canResumeRecord={eeg.canResumeRecord}
        canStartDevice={eeg.canStartDevice}
        canStartRecord={eeg.canStartRecord}
        canStopRecord={eeg.canStopRecord}
        timeWindowSeconds={eeg.settings.timeWindowSeconds}
        onAmplitudeChange={eeg.setAmplitudeUvPerDiv}
        onPauseRecord={eeg.pauseRecord}
        onReset={eeg.reset}
        onResumeRecord={eeg.resumeRecord}
        onStartDevice={eeg.startDevice}
        onStartRecord={eeg.startRecord}
        onStopRecord={eeg.stopRecord}
        onTimeWindowChange={eeg.setTimeWindowSeconds}
      />

      {eeg.errorMessage ? <div className={styles.errorMessage}>{eeg.errorMessage}</div> : null}

      <div className={styles.monitorGrid}>
        <EegWaveformPanel
          amplitudeUvPerDiv={eeg.settings.amplitudeUvPerDiv}
          snapshot={eeg.snapshot}
        />
        <EegChannelList
          channels={eeg.channels}
          visibleChannelIds={eeg.settings.visibleChannelIds}
          onToggleChannel={eeg.toggleChannel}
        />
      </div>

      <footer className={styles.footer}>
        <span>Window {eeg.settings.timeWindowSeconds}s</span>
        <span>Scale {eeg.settings.amplitudeUvPerDiv} uV/div</span>
        <span>Buffered {eeg.snapshot.retainedSampleCount} samples</span>
        <span>Sequence {eeg.snapshot.latestSequence ?? '-'}</span>
      </footer>
    </section>
  );
}
