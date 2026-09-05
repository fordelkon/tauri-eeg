import Button from '@mui/material/Button';
import { useEegSession } from '../../eeg/EegSessionContext';
import styles from './EffectEvaluation.module.css';

/**
 * Context-strip device quick-start: a one-click start while the EEG device is
 * not streaming, and a retry entry for the existing errorMessage on 'error'.
 * The buttons only trigger the context's own actions — the streaming
 * confirmation arrives through the eeg://status event mirror (the context's
 * 30s-start-timeout semantics stay untouched), and the EEG association badge
 * on the page keeps the describeEegAssociation trial-run wording.
 */
export default function EffectDeviceQuickStart() {
  const eeg = useEegSession();

  if (eeg.deviceStatus === 'streaming') {
    return <span className={styles.configChip}>EEG 设备已就绪</span>;
  }

  if (eeg.deviceStatus === 'error') {
    return (
      <>
        {/* Backend messages can be long: cap the pill with an ellipsis and
            put the full text on title. */}
        <span
          role="status"
          title={eeg.errorMessage ?? undefined}
          className={`${styles.eegChip} ${styles.eegUnavailable} ${styles.eegBadgeProminent} ${styles.deviceErrorChip}`}
        >
          ! EEG 设备异常{eeg.errorMessage ? `：${eeg.errorMessage}` : ''}
        </span>
        <Button
          size="small"
          variant="outlined"
          onClick={() => void eeg.retryLastFailedAction()}
        >
          重试上次操作
        </Button>
      </>
    );
  }

  return (
    <>
      <span className={styles.configChip}>
        {eeg.deviceStatus === 'starting'
          ? 'EEG 设备启动中…'
          : eeg.deviceStatus === 'stopping'
            ? 'EEG 设备停止中…'
            : 'EEG 设备未连接'}
      </span>
      {eeg.deviceStatus !== 'stopping' ? (
        <Button
          size="small"
          variant="outlined"
          disabled={!eeg.canStartDevice}
          onClick={() => void eeg.startDevice()}
        >
          一键启动设备
        </Button>
      ) : null}
    </>
  );
}
