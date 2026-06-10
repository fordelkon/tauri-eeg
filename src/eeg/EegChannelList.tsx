import { Checkbox, FormControlLabel } from '@mui/material';
import styles from '../pages/home/EegAcquisition.module.css';
import type { EegChannel } from './types';

type Props = {
  channels: EegChannel[];
  visibleChannelIds: Set<string>;
  onToggleChannel: (channelId: string) => void;
};

export default function EegChannelList({ channels, visibleChannelIds, onToggleChannel }: Props) {
  return (
    <aside className={styles.channelPanel} aria-label="EEG channel visibility">
      <div className={styles.panelTitle}>Channels</div>
      <div className={styles.channelToggleGrid}>
        {channels.map((channel) => (
          <FormControlLabel
            key={channel.id}
            className={styles.channelToggle}
            control={(
              <Checkbox
                size="small"
                checked={visibleChannelIds.has(channel.id)}
                onChange={() => onToggleChannel(channel.id)}
              />
            )}
            label={channel.label}
          />
        ))}
      </div>
    </aside>
  );
}
