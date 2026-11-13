import { Button, Dialog, DialogTitle, IconButton } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useEffect, useState } from 'react';
import { chooseStorageRoot } from '../storage/storageDirectoryPicker';
import { getStorageLocation, setStorageRoot, type StorageLocation } from '../storage/storageApi';
import { describeFriendlyError } from '../ui/friendlyError';
import styles from './StorageSettingsPanel.module.css';

/**
 * Storage-path settings panel of the home shell's sidebar: shows the active
 * root, lets the operator browse for a custom directory or restore the
 * default, and saves the choice. Own actions share one pending flag so the
 * buttons cannot double-fire while an IPC roundtrip is in flight.
 */

type StorageSettingsPanelProps = {
  onClose: () => void;
  username?: string;
};

export default function StorageSettingsPanel({ onClose, username }: StorageSettingsPanelProps) {
  const [storageLocation, setStorageLocation] = useState<StorageLocation | null>(null);
  const [storageInput, setStorageInput] = useState('');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [isStoragePending, setIsStoragePending] = useState(false);

  useEffect(() => {
    let isMounted = true;

    getStorageLocation()
      .then((location) => {
        if (isMounted) {
          setStorageLocation(location);
          setStorageInput(location.root);
        }
      })
      .catch((reason: unknown) => {
        if (isMounted) {
          setStorageError(describeFriendlyError(reason, '读取存储路径'));
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const runStorageAction = async (action: () => Promise<void>) => {
    if (isStoragePending) return;
    setIsStoragePending(true);
    try {
      await action();
    } finally {
      setIsStoragePending(false);
    }
  };

  const handleSaveStorageRoot = async () => {
    setStorageError(null);

    try {
      const location = await setStorageRoot(storageInput);
      setStorageLocation(location);
      setStorageInput(location.root);
      onClose();
    } catch (reason) {
      setStorageError(describeFriendlyError(reason, '保存存储路径'));
    }
  };

  const handleResetStorageRoot = async () => {
    setStorageError(null);

    try {
      const location = await setStorageRoot(null);
      setStorageLocation(location);
      setStorageInput(location.root);
    } catch (reason) {
      setStorageError(describeFriendlyError(reason, '恢复默认存储路径'));
    }
  };

  const handleChooseStorageRoot = async () => {
    setStorageError(null);

    try {
      const location = await chooseStorageRoot();
      if (location) {
        setStorageLocation(location);
        setStorageInput(location.root);
      }
    } catch (reason) {
      setStorageError(describeFriendlyError(reason, '选择存储目录'));
    }
  };

  return (
    <Dialog open fullWidth maxWidth="xs" onClose={onClose} aria-labelledby="storage-title">
      <div className={styles.header}>
        <DialogTitle id="storage-title">存储路径设置</DialogTitle>
        <IconButton aria-label="关闭存储设置" onClick={onClose}>
          <CloseRoundedIcon />
        </IconButton>
      </div>
      <div className={styles.body}>
        <label htmlFor="storage-root">存储根目录</label>
        <div className={styles.inputRow}>
          <input
            id="storage-root"
            value={storageInput}
            onChange={(event) => setStorageInput(event.currentTarget.value)}
            placeholder="D:\ExperimentData"
            spellCheck={false}
          />
          <Button
            variant="outlined"
            disabled={isStoragePending}
            onClick={() => void runStorageAction(handleChooseStorageRoot)}
          >
            浏览
          </Button>
        </div>
        {storageLocation && (
          <div className={styles.pathPreview}>
            <span>当前目录</span>
            <code>{storageLocation.root}</code>
            {username && (
              <>
                <span>账号子目录</span>
                <code>
                  {username}\eeg_recordings
                  <br />
                  {username}\music
                </code>
              </>
            )}
          </div>
        )}
        {storageError && (
          <p className={styles.error} role="alert">
            {storageError}
          </p>
        )}
      </div>
      <footer className={styles.actions}>
        <Button
          color="inherit"
          disabled={isStoragePending}
          onClick={() => void runStorageAction(handleResetStorageRoot)}
        >
          恢复默认
        </Button>
        <Button
          variant="contained"
          disabled={isStoragePending}
          onClick={() => void runStorageAction(handleSaveStorageRoot)}
        >
          保存
        </Button>
      </footer>
    </Dialog>
  );
}
