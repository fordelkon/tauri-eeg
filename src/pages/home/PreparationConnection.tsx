import {
  connectTrigger,
  disconnectTrigger,
  testTrigger,
  type TriggerPort,
  type TriggerStatus,
} from '../../experiment/api';
import { triggerCheckPath } from '../../experiment/recordingPath';
import RecordingPathControl from './RecordingPathControl';
import styles from './ExperimentSettings.module.css';
import guide from './ExperimentPreparation.module.css';

type Props = {
  formal: boolean;
  locked: boolean;
  desktop: boolean;
  ports: TriggerPort[];
  port: string;
  status: TriggerStatus;
  setPort: (port: string) => void;
  setStatus: (status: TriggerStatus) => void;
  refresh: () => Promise<void>;
  perform: (key: string, context: string, action: () => Promise<void>) => Promise<void>;
  setNotice: (message: string) => void;
  busyClass: (key: string) => string;
  preparedPath: string;
  subjectMissing: boolean;
  copyPath: (test: boolean) => Promise<void>;
};

export default function PreparationConnection({
  formal,
  locked,
  desktop,
  ports,
  port,
  status,
  setPort,
  setStatus,
  refresh,
  perform,
  setNotice,
  busyClass,
  preparedPath,
  subjectMissing,
  copyPath,
}: Props) {
  const selectedTriggerPort = ports.find(
    (item) => item.portName === (status.connected ? status.portName : port),
  );
  return (
    <>
      <h3 className={guide.subheading}>Trigger 接口</h3>
      <p className={guide.introduction}>
        {formal
          ? '先连接触发盒，再用短 BDF 检查测试码。'
          : '排练可跳过设备连接。需要测试硬件时，仍可连接并发送 254。'}
      </p>
      <div className={styles.row}>
        <label>
          COM 端口
          <select
            aria-label="COM 端口"
            value={port}
            disabled={locked || status.connected}
            onChange={(event) => setPort(event.target.value)}
          >
            <option value="">选择端口</option>
            {ports.map((item) => (
              <option key={item.portName} value={item.portName}>
                {item.portName} {item.description}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={locked || !desktop}
          className={`${styles.ghostButton} ${busyClass('refresh')}`}
          onClick={() => void perform('refresh', '读取触发盒状态', refresh)}
        >
          刷新端口
        </button>
        <button
          type="button"
          disabled={locked || !desktop || (!status.connected && !port)}
          className={busyClass('connect')}
          onClick={() =>
            void perform('connect', '连接触发盒', async () => {
              setStatus(status.connected ? await disconnectTrigger() : await connectTrigger(port));
            })
          }
        >
          {status.connected ? '断开触发盒' : '连接触发盒'}
        </button>
      </div>
      {formal && (
        <RecordingPathControl
          test
          path={preparedPath ? triggerCheckPath(preparedPath) : ''}
          disabled={locked || !desktop || subjectMissing}
          onCopy={() => void copyPath(true)}
        />
      )}
      {selectedTriggerPort?.kind === 'bluetooth' && (
        <p className={styles.errorMessage} role="alert">
          {selectedTriggerPort.portName} 是蓝牙虚拟串口（手机、耳机等配对设备），不是触发盒；
          它可能显示「已连接」，但标记写入会失败。请插入 USB 触发盒后点击「刷新端口」， 并选择 USB
          Serial Port（FTDI）。
        </p>
      )}
      {status.connected && !status.tested && (
        <p className={styles.muted}>
          已连接但尚未测试：正式实验前必须先发送测试 Trigger（254），并在 ActiView/BDF
          中确认收到标记。
        </p>
      )}
      <button
        type="button"
        disabled={locked || !status.connected}
        className={`${styles.ghostButton} ${busyClass('test')}`}
        onClick={() =>
          void perform('test', '发送测试 Trigger', async () => {
            setStatus(await testTrigger());
            setNotice('测试码 254 已写入串口。请在 ActiView 和短 BDF 中确认标记。');
          })
        }
      >
        发送测试 Trigger
      </button>
      <p className={styles.muted}>只保留一个 tauri-eeg 窗口。串口写入成功不代表 BDF 已收到标记。</p>
      {status.lastError && <p className={styles.errorMessage}>{status.lastError}</p>}
    </>
  );
}
