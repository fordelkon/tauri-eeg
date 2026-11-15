import type { AgentActionId } from './agentActions';

export type AgentIntent = AgentActionId | 'unknown';

const punctuationPattern = /[\s,.!?;:，。、？！；：]+/g;

export function normalizeAgentInput(input: string): string {
  return input.trim().replace(punctuationPattern, '');
}

export function classifyStepRequest(input: string): 'advance' | 'help' | 'hold' | undefined {
  const step = /下一步|这一步|本步|当前步骤|继续|开始实验|\b(?:next|start|continue)\b/i;
  if (!step.test(input)) return;
  if (/不要|别|暂不|先不|不想|不需要|不用|不继续|勿|\b(?:do not|don't|stop)\b/i.test(input))
    return 'hold';
  if (/[?？]|怎么|如何|什么|请问|了解|为什么|是否|吗|能否|\b(?:how|what|why)\b/i.test(input))
    return 'help';
  const text = normalizeAgentInput(input).toLowerCase();
  if (
    /^(?:请帮我|帮我|请)?(?:进入下一步|到下一步|下一步|继续|开始实验)(?:吧)?$/.test(text) ||
    /^(?:please)?(?:next(?:step)?|start|continue)$/.test(text)
  )
    return 'advance';
}

export function classifyAgentIntent(input: string): AgentIntent {
  const normalized = normalizeAgentInput(input).toLowerCase();

  if (!normalized || /删除|清空|移除|delete|remove|drop/.test(normalized)) {
    return 'unknown';
  }
  const step = classifyStepRequest(input);
  if (step === 'hold') return 'cancel';
  if (step === 'help') return 'unknown';
  if (step === 'advance') return 'go_next_page';

  if (/(打开实验范式|进入实验范式|开始范式)/.test(normalized)) return 'open_paradigm';
  if (/(打开实验设置|进入实验设置|trigger设置|触发设置)/i.test(normalized))
    return 'open_experiment_settings';

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
