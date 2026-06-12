import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import PowerSettingsNewRoundedIcon from '@mui/icons-material/PowerSettingsNewRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import { Button, MenuItem, TextField } from '@mui/material';
import styles from '../pages/home/EegAcquisition.module.css';

type Props = {
  amplitudeUvPerDiv: number;
  canPauseRecord: boolean;
  canResumeRecord: boolean;
  canStartDevice: boolean;
  canStartRecord: boolean;
  canStopDevice: boolean;
  canStopRecord: boolean;
  timeWindowSeconds: number;
  onAmplitudeChange: (value: number) => void;
  onPauseRecord: () => void;
  onReset: () => void;
  onResumeRecord: () => void;
  onStartDevice: () => void;
  onStartRecord: () => void;
  onStopDevice: () => void;
  onStopRecord: () => void;
  onTimeWindowChange: (value: number) => void;
};

export default function EegControls({
  amplitudeUvPerDiv,
  canPauseRecord,
  canResumeRecord,
  canStartDevice,
  canStartRecord,
  canStopDevice,
  canStopRecord,
  timeWindowSeconds,
  onAmplitudeChange,
  onPauseRecord,
  onReset,
  onResumeRecord,
  onStartDevice,
  onStartRecord,
  onStopDevice,
  onStopRecord,
  onTimeWindowChange,
}: Props) {
  return (
    <div className={styles.controlStrip}>
      <Button
        className={styles.controlButton}
        variant="contained"
        startIcon={<PowerSettingsNewRoundedIcon />}
        disabled={!canStartDevice}
        onClick={onStartDevice}
      >
        Start Device
      </Button>
      <Button
        className={styles.controlButton}
        variant="outlined"
        startIcon={<PowerSettingsNewRoundedIcon />}
        disabled={!canStopDevice}
        onClick={onStopDevice}
      >
        Stop Device
      </Button>
      <Button
        className={styles.controlButton}
        variant="contained"
        startIcon={<PlayArrowRoundedIcon />}
        disabled={!canStartRecord}
        onClick={onStartRecord}
      >
        Start Record
      </Button>
      <Button
        className={styles.controlButton}
        variant="outlined"
        startIcon={canResumeRecord ? <PlayArrowRoundedIcon /> : <PauseRoundedIcon />}
        disabled={!canPauseRecord && !canResumeRecord}
        onClick={canResumeRecord ? onResumeRecord : onPauseRecord}
      >
        {canResumeRecord ? 'Resume Record' : 'Pause Record'}
      </Button>
      <Button
        className={styles.controlButton}
        variant="outlined"
        startIcon={<StopRoundedIcon />}
        disabled={!canStopRecord}
        onClick={onStopRecord}
      >
        Stop Record
      </Button>
      <Button className={styles.controlButton} variant="outlined" startIcon={<RestartAltRoundedIcon />} onClick={onReset}>
        Reset View
      </Button>
      <TextField
        className={styles.controlSelect}
        select
        size="small"
        label="Window"
        value={timeWindowSeconds}
        onChange={(event) => onTimeWindowChange(Number(event.target.value))}
      >
        {[5, 10, 30].map((value) => (
          <MenuItem key={value} value={value}>{value}s</MenuItem>
        ))}
      </TextField>
      <TextField
        className={styles.controlSelect}
        select
        size="small"
        label="Scale"
        value={amplitudeUvPerDiv}
        onChange={(event) => onAmplitudeChange(Number(event.target.value))}
      >
        {[50, 100, 200, 500].map((value) => (
          <MenuItem key={value} value={value}>{value} uV/div</MenuItem>
        ))}
      </TextField>
    </div>
  );
}
