import { useEffect, useState } from 'react';
import { chooseStorageRoot } from '../storage/storageDirectoryPicker';
import { getStorageLocation, setStorageRoot, type StorageLocation } from '../storage/storageApi';
import { describeFriendlyError } from '../ui/friendlyError';
import styles from './Home.module.css';

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
    <section className={styles.storagePanel} aria-label="存储路径设置">
      <label className={styles.storageField}>
        <span>存储根目录</span>
        <input
          value={storageInput}
          onChange={(event) => setStorageInput(event.currentTarget.value)}
          placeholder="D:\\ExperimentData"
        />
      </label>
      <div className={styles.storagePreview}>
        <span>{storageLocation?.root ?? '默认应用数据目录'}</span>
        <strong>
          {username
            ? `${username}\\eeg_recordings | ${username}\\music`
            : 'username\\eeg_recordings | username\\music'}
        </strong>
      </div>
      {storageError ? <div className={styles.storageError}>{storageError}</div> : null}
      <div className={styles.storageActions}>
        <button
          type="button"
          disabled={isStoragePending}
          onClick={() => void runStorageAction(handleChooseStorageRoot)}
        >
          浏览
        </button>
        <button
          type="button"
          disabled={isStoragePending}
          onClick={() => void runStorageAction(handleResetStorageRoot)}
        >
          默认
        </button>
        <button
          type="button"
          disabled={isStoragePending}
          onClick={() => void runStorageAction(handleSaveStorageRoot)}
        >
          保存
        </button>
      </div>
    </section>
  );
}
