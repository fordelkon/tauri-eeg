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
      readText(new URL('../eeg/EegControls.tsx', import.meta.url)),
      readText(new URL('./home/GameRegulation.tsx', import.meta.url)),
      readText(new URL('./home/MusicRegulation.tsx', import.meta.url)),
      readText(new URL('./home/VideoRegulation.tsx', import.meta.url)),
      readText(new URL('../mentalScale/mentalScaleGate.ts', import.meta.url)),
      readText(new URL('../mentalScale/MentalScaleDialog.tsx', import.meta.url)),
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
      '刷新',
      '扫描',
      '滚动',
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

  test('localizes the paradigm acquisition flow copy', () => {
    const sources = [
      readText(new URL('./Home.tsx', import.meta.url)),
      readText(new URL('./home/EegAcquisition.tsx', import.meta.url)),
      readText(new URL('../eeg/paradigm/ParadigmSetupPanel.tsx', import.meta.url)),
      readText(new URL('../eeg/paradigm/ParadigmVideoPreview.tsx', import.meta.url)),
      readText(new URL('../eeg/paradigm/ParadigmRunner.tsx', import.meta.url)),
      readText(new URL('../eeg/paradigm/TrialStageRenderer.tsx', import.meta.url)),
      readText(new URL('../eeg/paradigm/SamRatingDialog.tsx', import.meta.url)),
      readText(new URL('../eeg/paradigm/types.ts', import.meta.url)),
    ].join('\n');

    [
      '自由采集',
      '范式采集',
      '范式 Session 进行中',
      '请先结束当前范式 Session,再切换页面。',
      '实验信息',
      '个人校准',
      '独立诱发调控',
      '依次诱发焦虑、抑郁、恐惧三类情绪',
      '被试 ID',
      '会话运行 ID',
      '连续随机播放',
      '选择视频根目录',
      '素材清单(点击文件名全屏预览)',
      '关闭预览',
      '入选',
      '开始实验',
      '试运行',
      '试运行模式:跳过设备检查,数据不写入。',
      '试运行结束,未写入任何数据。',
      '阶段间休息',
      '开始下一阶段',
      '静息放松,减少眨眼与头动',
      '即将播放视频,请保持注视屏幕',
      '即将播放第',
      '个视频 · 请按真实感受评分',
      '愉悦度(1 非常负性 ~ 9 非常正性)',
      '唤醒度(1 非常平静 ~ 9 非常激动)',
      '优势感,选填',
      '提交自评',
      '正在保存试次',
      '正在准备下一个视频',
      '重试保存试次',
      '提前结束 Session',
      '训练前统计',
      '返回设置',
      '抑郁',
      '焦虑',
      '平静',
      '恐惧',
      '快乐',
      '接纳',
      '不确定',
      '拒收',
      '伪迹拒收',
    ].forEach((copy) => {
      expect(sources).toContain(copy);
    });
  });

});

