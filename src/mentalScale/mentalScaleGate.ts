export type MentalScalePath = '/video-regulation' | '/game-regulation' | '/music-regulation';

export type MentalScaleAnswerValue = 0 | 1 | 2 | 3;

export type MentalScaleQuestion = {
  id: string;
  prompt: string;
};

export type MentalScaleDefinition = {
  path: MentalScalePath;
  title: string;
  subtitle: string;
  questions: MentalScaleQuestion[];
};

export type MentalScaleAnswers = Record<string, MentalScaleAnswerValue | undefined>;

export const mentalScaleAnswerOptions: Array<{ value: MentalScaleAnswerValue; label: string }> = [
  { value: 0, label: '从不' },
  { value: 1, label: '偶尔' },
  { value: 2, label: '经常' },
  { value: 3, label: '几乎每天' },
];

export const mentalScaleDefinitions: Record<MentalScalePath, MentalScaleDefinition> = {
  '/video-regulation': {
    path: '/video-regulation',
    title: '视频调控量表',
    subtitle: '请根据最近一周的状态完成简短心理量表。',
    questions: [
      { id: 'video-anxiety-tense', prompt: '最近一周，我感到紧张、焦虑或坐立不安。' },
      { id: 'video-anxiety-worry', prompt: '最近一周，我难以停止或控制担忧。' },
      { id: 'video-depression-interest', prompt: '最近一周，我对平时感兴趣的事情兴趣下降。' },
    ],
  },
  '/game-regulation': {
    path: '/game-regulation',
    title: '游戏调控量表',
    subtitle: '请先完成当前情绪状态记录，再进入游戏调节。',
    questions: [
      { id: 'game-anxiety-irritable', prompt: '最近一周，我容易烦躁或难以放松。' },
      { id: 'game-depression-energy', prompt: '最近一周，我感觉精力不足或做事提不起劲。' },
      { id: 'game-depression-self-blame', prompt: '最近一周，我对自己的表现感到消极或自责。' },
    ],
  },
  '/music-regulation': {
    path: '/music-regulation',
    title: '音乐调控量表',
    subtitle: '请先完成简短心理量表，再进入音乐调节。',
    questions: [
      { id: 'music-depression-low', prompt: '最近一周，我感到情绪低落、沮丧或无望。' },
      { id: 'music-depression-sleep', prompt: '最近一周，我入睡困难、睡不安稳或睡太多。' },
      { id: 'music-anxiety-relax', prompt: '最近一周，我觉得放松下来比较困难。' },
    ],
  },
};

export function getMentalScaleForPath(path: string): MentalScaleDefinition | null {
  if (path in mentalScaleDefinitions) {
    return mentalScaleDefinitions[path as MentalScalePath];
  }

  return null;
}

export function isMentalScaleComplete(
  scale: MentalScaleDefinition,
  answers: MentalScaleAnswers,
): boolean {
  return scale.questions.every((question) => answers[question.id] !== undefined);
}
