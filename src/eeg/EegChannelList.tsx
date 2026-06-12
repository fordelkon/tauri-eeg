import { Checkbox, FormControlLabel } from '@mui/material';
import styles from '../pages/home/EegAcquisition.module.css';
import { MAX_VISIBLE_EEG_CHANNELS } from './channels';
import type { EegChannel } from './types';

type Props = {
  channels: EegChannel[];
  visibleChannelIds: Set<string>;
  onToggleChannel: (channelId: string) => void;
};

export default function EegChannelList({ channels, visibleChannelIds, onToggleChannel }: Props) {
  const selectedCount = visibleChannelIds.size;
  const isAtVisibleLimit = selectedCount >= MAX_VISIBLE_EEG_CHANNELS;

  return (
    <aside className={styles.channelPanel} aria-label="EEG channel visibility">
      <div className={styles.panelTitle}>Channels {selectedCount}/{channels.length}</div>
      <div className={styles.channelToggleGrid}>
        {channels.map((channel) => {
          const checked = visibleChannelIds.has(channel.id);
          const disabled = !checked && isAtVisibleLimit;

          return (
            <FormControlLabel
              key={channel.id}
              className={styles.channelToggle}
              control={(
                <Checkbox
                  size="small"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggleChannel(channel.id)}
                />
              )}
              disabled={disabled}
              label={channel.label}
            />
          );
        })}
      </div>
    </aside>
  );
}
