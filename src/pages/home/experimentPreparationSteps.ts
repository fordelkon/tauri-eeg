import type { TriggerStatus } from '../../experiment/api';
import type { PreparationStep } from '../../experiment/preparation';

export const steps = [
  {
    id: 'plan',
    title: '选择实验',
    software: 'tauri-eeg',
    instructions: [
      '先选择要运行的流程。效果评价与个人校准是不同实验。',
      '正式实验自动发送阶段标记；排练保留日志，但不发送流程标记。',
      '在同一个应用窗口完成准备和实验。新窗口默认排练。',
    ],
  },
  {
    id: 'connection',
    title: '连接与测试',
    software: '两个软件配合',
    instructions: [
      'ActiView：点击 Start，确认采样率非零。点击 Start File 保存短测试 BDF。',
      'tauri-eeg：连接触发盒，发送测试码 254。',
      'ActiView / ActiRead：核对 254 确实进入文件。发送提示不能代替 BDF 检查。',
    ],
  },
  {
    id: 'materials',
    title: '准备素材',
    software: 'tauri-eeg',
    instructions: [
      '选择包含诱发视频的素材库，验证后再继续。',
      '音乐效果评价：实验前先到音乐调控页生成曲目。',
      '个人校准使用平静视频；独立诱发使用焦虑、抑郁和恐惧视频。',
    ],
  },
  {
    id: 'recording',
    title: '保存脑电',
    software: 'ActiView → tauri-eeg',
    instructions: [
      'ActiView：结束短测试，新建本次实验 BDF；每次使用不同文件名。',
      '确认绿色 Saving，并观察 Total Saved 秒数持续增加。',
      '将正式文件路径粘贴到 ActiView 的 Start File 文件名栏，再确认保存。',
    ],
  },
  {
    id: 'review',
    title: '核对并进入',
    software: 'tauri-eeg',
    instructions: [
      '核对运行模式与本次配置，准备就绪后进入所选流程。',
      '实验运行时，tauri-eeg 自动打标，ActiView 持续保存。',
      '实验结束后在 ActiView 正常停止保存，再关联 BDF、导出日志。',
    ],
  },
] satisfies { id: PreparationStep; title: string; software: string; instructions: string[] }[];

export function getPreparationInstructions(step: number, formal: boolean): readonly string[] {
  const current = steps[step];
  if (!formal && current.id === 'connection') return ['排练可跳过设备连接，继续准备素材。'];
  if (!formal && current.id === 'recording') return ['排练无需 ActiView 保存，可以继续核对实验。'];
  if (!formal && current.id === 'review') {
    return ['核对本次配置和素材。进入排练后会保存操作记录，不发送流程标记。'];
  }
  return current.instructions;
}

export const emptyStatus: TriggerStatus = {
  connected: false,
  tested: false,
  portName: null,
  activeRunId: null,
  lastError: null,
};
