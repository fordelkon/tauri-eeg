// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (url: URL) => readFileSync(url, 'utf8');

describe('page Chinese copy', () => {
  test('localizes the top-level pages and home shell copy', () => {
    const sources = [
      readText(new URL('./Home.tsx', import.meta.url)),
      readText(new URL('./NotFound.tsx', import.meta.url)),
      readText(new URL('./home/HomeOverview.tsx', import.meta.url)),
      readText(new URL('./home/EegAcquisition.tsx', import.meta.url)),
      readText(new URL('./home/GameRegulation.tsx', import.meta.url)),
      readText(new URL('./home/MusicRegulation.tsx', import.meta.url)),
      readText(new URL('./home/VideoRegulation.tsx', import.meta.url)),
      readText(new URL('../mentalScale/mentalScaleGate.ts', import.meta.url)),
    ].join('\n');

    [
      '首页',
      '已登录',
      '存储路径设置',
      '心理量表',
      '完成全部题目后继续。',
      '进入',
      '页面未找到',
      '当前 EEG 系统路由尚未实现。',
      '脑电情绪调节首页标志',
      '采集监测',
      '实时脑电',
      '设备',
      '记录',
      '游戏调控',
      'VR 与 AR 调控',
      '音乐调控播放器',
      'WAV 音乐生成',
      '提示词构建',
      '乐器',
      '风格',
      '细节',
      '生成 WAV',
      '生成记录',
      '视频调控',
      '视频调节播放器',
      '视频调控量表',
      '游戏调控量表',
      '音乐调控量表',
    ].forEach((copy) => {
      expect(sources).toContain(copy);
    });

    [
      'Signed in',
      'Storage path settings',
      'Psychological Scale',
      'Complete all questions to continue.',
      'Page Not Found',
      'This EEG Ecosystem route has not been implemented yet.',
      'EEG emotion regulation home logo',
      'Acquisition Monitor',
      'Realtime EEG',
      'Game Regulation',
      'VR and AR Regulation',
      'Regulation Player',
      'WAV Music Generation',
      'Prompt Builder',
      'Generate WAV',
      'Generated WAV history',
      'Video Regulation',
      'Regulation video player',
      'Video Regulation Scale',
      'Game Regulation Scale',
      'Music Regulation Scale',
    ].forEach((copy) => {
      expect(sources).not.toContain(copy);
    });
  });
});
