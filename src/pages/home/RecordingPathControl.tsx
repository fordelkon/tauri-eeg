import styles from './ExperimentSettings.module.css';

type Props = { test?: boolean; path: string; disabled: boolean; onCopy: () => void };

export default function RecordingPathControl({ test = false, path, disabled, onCopy }: Props) {
  const label = test ? '短测试 BDF 路径' : '正式 BDF 路径';
  return (
    <div>
      {path && (
        <label>
          {label}
          <input value={path} readOnly onFocus={(event) => event.currentTarget.select()} />
        </label>
      )}
      <button type="button" disabled={disabled} className={styles.ghostButton} onClick={onCopy}>
        {path ? '复制' : '准备并复制'}
        {label}
      </button>
      <p className={styles.muted}>
        {test
          ? '先用短测试文件核对 254。正式实验请使用「保存脑电」页的正式文件路径。'
          : '文件保存在桌面的 EEG数据集 目录。将完整路径粘贴到 ActiView，开始保存后才会生成 BDF。'}
      </p>
    </div>
  );
}
