export type GameRegulationOption = {
  buttonLabel: string;
  description: string;
  id: string;
  imageSrc: string;
  mode: 'VR' | 'AR';
  title: string;
};

export const gameRegulationOptions: GameRegulationOption[] = [
  {
    buttonLabel: '准备进入',
    description: '以沉浸式视觉场景承载运动式游戏调控，当前仅展示入口。',
    id: 'vr-motion',
    imageSrc: '/game1.jpg',
    mode: 'VR',
    title: '运动式游戏调控 - 星海寻真',
  },
  {
    buttonLabel: '准备进入',
    description: '以增强现实场景辅助呼吸节律训练，当前仅展示入口。',
    id: 'ar-breathing',
    imageSrc: '/game2.jpg',
    mode: 'AR',
    title: '呼吸式游戏调控 - 呼吸放松',
  },
];
