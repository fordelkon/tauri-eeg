import { useEffect, useMemo, useState } from 'react';
import { buildEegStatusPanelView } from './eegStatusPanelView';
import { useEegSession } from './EegSessionContext';
import styles from './GlobalEegStatusPanel.module.css';

export default function GlobalEegStatusPanel() {
  const eeg = useEegSession();
  const visibleChannelCount = eeg.settings.visibleChannelIds.size;
  const [retainedSampleCount, setRetainedSampleCount] = useState(() => (
    eeg.takeSnapshot().retainedSampleCount
  ));

  useEffect(() => {
    setRetainedSampleCount(eeg.takeSnapshot().retainedSampleCount);

    const interval = window.setInterval(() => {
      setRetainedSampleCount(eeg.takeSnapshot().retainedSampleCount);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [eeg]);

  const view = useMemo(() => buildEegStatusPanelView({
    channelCount: eeg.channels.length,
    deviceStatus: eeg.deviceStatus,
    errorMessage: eeg.errorMessage,
    recordStatus: eeg.recordStatus,
    retainedSampleCount,
    sampleRateHz: eeg.sampleRateHz,
    visibleChannelCount,
  }), [
    eeg.channels.length,
    eeg.deviceStatus,
    eeg.errorMessage,
    eeg.recordStatus,
    eeg.sampleRateHz,
    retainedSampleCount,
    visibleChannelCount,
  ]);

  return (
    <aside className={styles.panel} aria-label="Global EEG status">
      <div className={styles.header}>
        <span className={styles.eyebrow}>EEG Status</span>
        <div className={styles.titleRow}>
          <span className={`${styles.statusDot} ${styles[view.tone]}`} aria-hidden="true" />
          <h2 className={styles.headline}>{view.headline}</h2>
        </div>
        <p className={styles.summary}>
          Device {view.deviceLabel.toLowerCase()}, record {view.recordLabel.toLowerCase()}.
        </p>
      </div>

      {view.errorMessage ? (
        <div className={styles.errorMessage} role="status">
          {view.errorMessage}
        </div>
      ) : null}

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Device</span>
          <span className={styles.metricValue}>{view.deviceLabel}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Record</span>
          <span className={styles.metricValue}>{view.recordLabel}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Sample Rate</span>
          <span className={styles.metricValue}>{view.sampleRateLabel}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Channels</span>
          <span className={styles.metricValue}>{view.channelsLabel}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Buffer</span>
          <span className={styles.metricValue}>{view.bufferLabel}</span>
        </div>
      </div>
    </aside>
  );
}
