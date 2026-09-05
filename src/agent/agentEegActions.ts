import type { AgentPhase } from './agentFlow';
import {
  getRecommendedPrompt,
  getNextAgentPhase,
  getRouteForAgentPhase,
} from './agentFlow';
import {
  validateAgentPauseRecord,
  validateAgentResumeRecord,
  validateAgentStartDevice,
  validateAgentStartRecord,
  validateAgentStopAndSaveRecord,
  validateAgentStopDevice,
  type AgentEegGuardView,
} from './agentEegGuards';
import type { AgentActionId } from './agentActions';
import type { EegDeviceStatus } from '../eeg/eegSessionState';

/**
 * Non-React implementations of the experiment agent's EEG device/record
 * commands (the start/stop/pause/resume family plus the two composite
 * actions). Extracted from useExperimentAgent so the command choreography is
 * readable — and testable — without the hook's planning state around it.
 *
 * Every function receives an explicit execution context (guard view, phase,
 * session commands, message sink) instead of closing over React state, so
 * call-time refusal behavior stays identical to the inline switch it replaced.
 */

/** Copy for a context command that failed after the guard passed; the mapped
 * operator-facing detail is on the EEG page via eeg.errorMessage. */
function eegCommandFailureMessage(commandLabel: string): string {
  return `${commandLabel}失败，详情见 EEG 采集页错误提示。`;
}

export type AgentEegActionContext = {
  eegGuardView: AgentEegGuardView;
  phase: AgentPhase;
  canStartDevice: boolean;
  canStopRecord: boolean;
  deviceStatus: EegDeviceStatus;
  startDevice: () => Promise<boolean>;
  stopDevice: () => Promise<boolean>;
  startRecord: () => Promise<boolean>;
  pauseRecord: () => boolean;
  resumeRecord: () => boolean;
  stopRecord: () => Promise<boolean>;
  setMessage: (message: string) => void;
  navigateTo: (path: string) => void;
};

export async function executeAgentEegAction(
  actionId: AgentActionId,
  context: AgentEegActionContext,
): Promise<void> {
  const {
    eegGuardView,
    phase,
    canStartDevice,
    canStopRecord,
    deviceStatus,
    startDevice,
    stopDevice,
    startRecord,
    pauseRecord,
    resumeRecord,
    stopRecord,
    setMessage,
    navigateTo,
  } = context;

  switch (actionId) {
    case 'start_eeg_device': {
      const verdict = validateAgentStartDevice(eegGuardView);
      if (!verdict.ok) {
        setMessage(verdict.reason);
        return;
      }

      const accepted = await startDevice();
      setMessage(accepted
        ? '已请求启动 EEG 设备。'
        : eegCommandFailureMessage('启动 EEG 设备'));
      return;
    }
    case 'stop_eeg_device': {
      const verdict = validateAgentStopDevice(eegGuardView);
      if (!verdict.ok) {
        setMessage(verdict.reason);
        return;
      }

      // Same sequence as the manual guard on the EEG page: an active
      // recording is saved through the normal stop path first, and a failed
      // save aborts the shutdown instead of silently dropping the data.
      const mustSaveFirst = canStopRecord;
      if (mustSaveFirst) {
        const saved = await stopRecord();
        if (!saved) {
          setMessage('停止并保存 EEG 数据失败，设备保持连接，详情见 EEG 采集页错误提示。');
          return;
        }
      }

      const stopped = await stopDevice();
      setMessage(stopped
        ? (mustSaveFirst ? '已停止并保存 EEG 数据，设备已关闭。' : '已停止 EEG 设备。')
        : eegCommandFailureMessage('停止 EEG 设备'));
      return;
    }
    case 'start_eeg_recording': {
      const verdict = validateAgentStartRecord(eegGuardView);
      if (!verdict.ok) {
        setMessage(verdict.reason);
        return;
      }

      const started = await startRecord();
      setMessage(started
        ? (phase === 'recovery' ? '已开始恢复采集。' : '已开始基线采集。')
        : eegCommandFailureMessage('开始 EEG 采集'));
      return;
    }
    case 'pause_eeg_recording': {
      const verdict = validateAgentPauseRecord(eegGuardView);
      if (!verdict.ok) {
        setMessage(verdict.reason);
        return;
      }

      setMessage(pauseRecord() ? '已暂停 EEG 采集。' : eegCommandFailureMessage('暂停 EEG 采集'));
      return;
    }
    case 'resume_eeg_recording': {
      const verdict = validateAgentResumeRecord(eegGuardView);
      if (!verdict.ok) {
        setMessage(verdict.reason);
        return;
      }

      setMessage(resumeRecord() ? '已继续 EEG 采集。' : eegCommandFailureMessage('继续 EEG 采集'));
      return;
    }
    case 'stop_and_save_eeg_recording': {
      const verdict = validateAgentStopAndSaveRecord(eegGuardView);
      if (!verdict.ok) {
        setMessage(verdict.reason);
        return;
      }

      const saved = await stopRecord();
      setMessage(saved
        ? '已停止并保存 EEG 数据。'
        : 'EEG 记录未能停止保存，数据尚未落盘，详情见 EEG 采集页错误提示。');
      return;
    }
    case 'start_eeg_device_and_record': {
      if (canStartDevice) {
        await startDevice();
      } else if (deviceStatus === 'stopping') {
        setMessage('EEG 设备正在停止中，请等待停止完成后再试。');
        return;
      }

      // Click-time snapshot: right after requesting the device start the
      // stream cannot be recording-ready yet, so this reports not-ready
      // (with the matching reason) instead of pretending capture began.
      // startRecord itself re-checks the same gate internally.
      const recordVerdict = validateAgentStartRecord(eegGuardView);
      if (!recordVerdict.ok) {
        setMessage(recordVerdict.reason);
        return;
      }

      const started = await startRecord();
      setMessage(started
        ? (phase === 'recovery' ? '已启动设备并开始恢复采集。' : '已启动设备并开始基线采集。')
        : eegCommandFailureMessage('开始 EEG 采集'));
      return;
    }
    case 'stop_save_eeg_and_go_next': {
      const verdict = validateAgentStopAndSaveRecord(eegGuardView);
      if (!verdict.ok) {
        setMessage(verdict.reason);
        return;
      }

      const saved = await stopRecord();
      if (!saved) {
        setMessage('EEG 记录未能停止保存，仍停留在当前阶段，详情见 EEG 采集页错误提示。');
        return;
      }

      const nextPhase = getNextAgentPhase(phase);
      navigateTo(getRouteForAgentPhase(nextPhase));
      setMessage(`已停止并保存 EEG 数据，进入：${getRecommendedPrompt(nextPhase)}`);
      return;
    }
    default:
      return;
  }
}
