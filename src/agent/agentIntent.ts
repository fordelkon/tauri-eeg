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

  if (/(打开实验范式|进入实验范式|开始范式)/.test(normalized)) return 'open_paradigm';
  if (/(打开实验设置|进入实验设置|trigger设置|触发设置)/i.test(normalized))
    return 'open_experiment_settings';

  if (/(下一步|继续|开始实验|start|next)/i.test(normalized)) {
    return 'go_next_page';
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
