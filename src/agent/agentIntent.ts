import type { AgentActionId } from './agentActions';

export type AgentIntent = AgentActionId | 'unknown';

const punctuationPattern = /[\s,，。、？！；：]+/g;

export function normalizeAgentInput(input: string): string {
  return input.trim().replace(punctuationPattern, '');
}

export function classifyAgentIntent(input: string): AgentIntent {
  const normalized = normalizeAgentInput(input).toLowerCase();

  if (!normalized || /删除|清空|移除|delete|remove|drop/.test(normalized)) {
    return 'unknown';
  }

  if (/(下一步|继续|开始实验|start|next)/i.test(normalized)) {
    return 'go_next_page';
  }

  if (/(启动设备|连接设备|开始设备|startdevice)/i.test(normalized)) {
    return 'start_eeg_device';
  }

  if (/(停止设备|关闭设备|stopdevice)/i.test(normalized)) {
    return 'stop_eeg_device';
  }

  if (/(开始基线采集|开始恢复采集|开始采集|开始记录|开始录制|startrecord)/i.test(normalized)) {
    return 'start_eeg_device_and_record';
  }

  if (/(暂停采集|暂停记录|pauserecord)/i.test(normalized)) {
    return 'pause_eeg_recording';
  }

  if (/(恢复采集|继续记录|resumerecord)/i.test(normalized)) {
    return 'resume_eeg_recording';
  }

  if (/(结束并保存|停止并保存|保存数据|结束采集|停止记录|stoprecord)/i.test(normalized)) {
    return 'stop_and_save_eeg_recording';
  }

  if (/(选择视频|匹配视频|selectvideo)/i.test(normalized)) {
    return 'select_video';
  }

  if (/(播放.*视频|放松视频|playvideo)/i.test(normalized)) {
    return 'play_video';
  }

  if (/(生成.*音乐|舒缓音乐|音乐生成|generatemusic)/i.test(normalized)) {
    return 'generate_music';
  }

  if (/(跳过.*游戏|跳过当前不可用环节|skipgame)/i.test(normalized)) {
    return 'skip_game';
  }

  if (/(完成实验|结束实验|finish)/i.test(normalized)) {
    return 'finish_experiment';
  }

  if (/(取消|cancel)/i.test(normalized)) {
    return 'cancel';
  }

  return 'unknown';
}
