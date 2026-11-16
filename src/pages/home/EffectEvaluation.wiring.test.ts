// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (url: URL) => readFileSync(url, 'utf8');

const pageUrl = new URL('./EffectEvaluation.tsx', import.meta.url);
const timelineUrl = new URL('./EffectTimeline.tsx', import.meta.url);
const disclosureUrl = new URL('./EffectProgressDisclosure.tsx', import.meta.url);
const reviewUrl = new URL('./EffectReviewPopover.tsx', import.meta.url);
const panelsUrl = new URL('./EffectStepPanels.tsx', import.meta.url);

describe('EffectEvaluation wiring contract', () => {
  test('registers the formal evaluation route', () => {
    const appSource = readText(new URL('../../App.tsx', import.meta.url));

    expect(appSource).toContain("import('./pages/home/EffectEvaluation')");
    expect(appSource).toContain('path="/effect-evaluation"');
  });

  test('adds the effect-evaluation entry to the home navigation', () => {
    const homeSource = readText(new URL('../Home.tsx', import.meta.url));

    expect(homeSource).toContain(
      "{ icon: InsightsRoundedIcon, label: '效果评价', path: '/effect-evaluation' }",
    );
  });

  test('opens the same DEQ dialog at each measurement point', () => {
    const page = readText(pageUrl);
    for (const phase of ['pre_induction', 'baseline', 'post']) {
      expect(page).toContain(`renderScalePanel('${phase}')`);
    }
    expect(readText(panelsUrl)).toContain('<DeqRatingDialog');
    expect(page).toContain('useConfirmDialog()');
  });
});

describe('subject passthrough contract', () => {
  test('saves phase records under the configured subject for all three phases', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));

    expect(hookSource).toContain('return savePhaseInstrumentRecord({');
    expect(hookSource).toContain('subjectId: current.subjectId.trim()');
    expect(hookSource).toContain('experimentRunId: current.runId');
  });

  test('shares the validated subject with the rest of the app on setup completion', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));

    expect(hookSource).toContain(
      "import { readStoredSubjectId, writeStoredSubjectId } from '../../storage/currentSubject'",
    );
    expect(hookSource).toContain('subjectSelected: writeStoredSubjectId');
  });

});

describe('strong duration constraint (R3 contract)', () => {
  test('locks the finish exit until zero and routes early exits through a confirmed skip', () => {
    const pageSource = readText(pageUrl);
    const panelsSource = readText(panelsUrl);
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));

    expect(pageSource).toContain('flow.regulationFinishMode()');
    expect(panelsSource).toContain("disabled={state.interrupted || finishMode.mode !== 'finish'}");
    expect(pageSource).toContain('title: `跳过剩余${windowNoun}时长？`');
    expect(pageSource).toContain("const windowNoun = isNaturalRecovery ? '静息' : '调控'");
    expect(pageSource).toContain('destructive: true');
    expect(hookSource).toContain('skipRemainingRegulation');
    expect(hookSource).toContain('skipRemainingRegulation: execution.skipRemainingRegulation');
  });

  test('persists emotion, duration, and the post-leg skip marker with phase records', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));

    expect(hookSource).toContain('emotion: current.emotion');
    expect(hookSource).toContain('durationMinutes: current.durationMinutes');
    expect(hookSource).toContain("phase === 'post' ? current.regulationSkipped : false");
  });
});

describe('report export & history review (R3 contract)', () => {
  test('exports single/batch reports through the save dialog and backend command', () => {
    const pageSource =
      readText(pageUrl) + readText(new URL('./useEffectReportExports.ts', import.meta.url));

    expect(pageSource).toContain("from '@tauri-apps/plugin-dialog'");
    expect(pageSource).toContain('buildSingleReportPayload');
    expect(pageSource).toContain('buildBatchReportPayload');
    expect(pageSource).toContain('exportEffectReport');
    expect(pageSource).toContain('导出单次报告');
    expect(pageSource).toContain('批量汇总导出');

    const apiSource = readText(new URL('../../mentalScale/scaleRecordsApi.ts', import.meta.url));
    expect(apiSource).toContain("'list_effect_history'");
    expect(apiSource).toContain("'export_effect_report'");
  });

  test('mounts the history review tab on the page', () => {
    const pageSource = readText(pageUrl);
    const panelSource = readText(new URL('./EffectHistoryPanel.tsx', import.meta.url));

    expect(pageSource).toContain('<EffectHistoryPanel');
    expect(pageSource).toContain('历史记录');
    expect(panelSource).toContain("'../../mentalScale/scaleRecordsApi'");
  });
});

describe('measured dimensions & eeg persistence (R4 contract)', () => {
  test('F4: regulation pages consume the session context and the paradigm gate is mutual', () => {
    for (const page of ['./MusicRegulation.tsx', './VideoRegulation.tsx'] as const) {
      const source = readText(new URL(page, import.meta.url));

      expect(source).toContain('useEffectRegulationContext(');
      expect(source).toContain('RegulationSessionBanner');
      expect(source).toContain('effectSessionBanner');
    }
    const bannerSource = readText(new URL('./regulationSessionBanner.tsx', import.meta.url));
    expect(bannerSource).toContain('effectSessionBanner');
    expect(bannerSource).toContain('效果评价调控时长已达成');

    const paradigmSource = readText(
      new URL('../../paradigm/ParadigmSetupPanel.tsx', import.meta.url),
    );
    expect(paradigmSource).toContain('isRegulationWindowOpenInStorage(window.sessionStorage)');
    expect(paradigmSource).toContain('效果评价调控进行中');
  });
});

describe('six-step flow & condition split (R6 contract)', () => {
  test('keeps researcher choices in preparation and gates induction on the media pool', () => {
    const panelsSource = readText(panelsUrl);
    const preparationSource = readText(new URL('./PreparationPlan.tsx', import.meta.url));
    const controlsSource = readText(new URL('./EffectResearchControls.tsx', import.meta.url));
    expect(preparationSource).toContain('<EffectResearchControls');
    expect(controlsSource).toContain('EFFECT_CONDITION_OPTIONS');
    expect(controlsSource).toContain('EFFECT_EMOTION_OPTIONS');
    expect(panelsSource).not.toContain('EFFECT_EMOTION_OPTIONS');
    expect(panelsSource).not.toContain('flow.updateDraft');
    expect(readText(new URL('./useEffectInductionPool.ts', import.meta.url))).toContain(
      'describeInductionPoolStatus',
    );
    expect(panelsSource).toContain('flow.inductionStatus');
    expect(panelsSource).toContain('status.copy');
    const inductionStageSource = readText(
      new URL('./EffectFullscreenInduction.tsx', import.meta.url),
    );
    expect(inductionStageSource).toContain('toPlayableInductionUrl(entry.absolutePath)');
    expect(inductionStageSource).toContain('onEnded={onFinished}');
  });

  test('the natural-recovery condition runs its countdown inside the wizard page', () => {
    const pageSource = readText(pageUrl);
    const panelsSource = readText(panelsUrl);
    const flowSource = readText(new URL('./effectEvaluationFlow/regulation.ts', import.meta.url));
    expect(pageSource).toContain("state.condition === 'natural_recovery'");
    expect(panelsSource).toContain("'开始静息'");
    expect(panelsSource).toContain('<EffectRestFixation');
    expect(panelsSource).toContain('onElapsed={() => void flow.finishRegulation()}');
    expect(panelsSource).toContain('flow.openRegulationPage');
    expect(panelsSource).toMatch(/isNaturalRecovery \? null : \(\s*<button/);
    expect(flowSource).toContain("state.condition !== 'regulation'");
  });

  test('shows the same three-timepoint result on completion and in history', () => {
    expect(readText(pageUrl)).toContain('<EmotionChangeTable');
    expect(readText(new URL('./EffectHistoryPanel.tsx', import.meta.url))).toContain('<EmotionChangeTable');
  });
});

describe('induction and history', () => {
  test('a failed induction video offers a retry and a way back to the setup step', () => {
    const pageSource = readText(pageUrl);
    const panelsSource = readText(panelsUrl);
    expect(panelsSource).toContain("inductionVideoFailed && status.kind === 'ready'");
    const inductionStageSource = readText(
      new URL('./EffectFullscreenInduction.tsx', import.meta.url),
    );
    expect(inductionStageSource).toContain('onError={onError}');
    expect(pageSource).toContain('setInductionVideoFailed(true)');
    expect(panelsSource).toContain('重试加载素材');
    expect(panelsSource).toContain('重置并返回设置步');
    expect(inductionStageSource).toContain('`${entry.videoId}-${retryCount}`');
  });

  test("the history panel shows each run's condition", () => {
    const panelSource = readText(new URL('./EffectHistoryPanel.tsx', import.meta.url));
    const viewSource = readText(new URL('./effectHistoryView.ts', import.meta.url));
    expect(panelSource).toContain('labelForHistoryCondition(entry.condition)');
    expect(viewSource).toContain('export function labelForHistoryCondition');
  });
});

describe('embedded regulation player (condition node contract)', () => {
  test('presents both video branches in a fullscreen stage with an explicit ready cue', () => {
    const panelsSource = readText(panelsUrl);
    const inductionStageSource = readText(
      new URL('./EffectFullscreenInduction.tsx', import.meta.url),
    );
    const regulationStageSource = readText(
      new URL('./EffectFullscreenVideoRegulation.tsx', import.meta.url),
    );
    const fullscreenHookSource = readText(
      new URL('./useParticipantFullscreen.ts', import.meta.url),
    );

    expect(panelsSource).toContain(
      "import { EffectFullscreenInduction } from './EffectFullscreenInduction'",
    );
    expect(panelsSource).toContain('<EffectFullscreenInduction');
    expect(panelsSource).not.toContain('className={styles.inductionVideo}');
    expect(inductionStageSource).toContain('准备观看视频');
    expect(inductionStageSource).toContain('开始播放视频');
    expect(regulationStageSource).toContain('准备观看视频');
    expect(regulationStageSource).toContain('开始播放视频');
    expect(inductionStageSource).toContain('正在加载视频');
    expect(regulationStageSource).toContain('正在加载视频');
    expect(fullscreenHookSource).toContain('document.documentElement.requestFullscreen');
  });

  test('presents video regulation as a fullscreen stage while music stays embedded', () => {
    const panelsSource = readText(panelsUrl);
    const fullscreenSource = readText(
      new URL('./EffectFullscreenVideoRegulation.tsx', import.meta.url),
    );
    expect(panelsSource).toContain("import EffectRegulationPlayer from './EffectRegulationPlayer'");
    expect(panelsSource).toContain(
      "import { EffectFullscreenVideoRegulation } from './EffectFullscreenVideoRegulation'",
    );
    expect(panelsSource).toContain('<EffectRegulationPlayer');
    expect(panelsSource).toContain('<EffectFullscreenVideoRegulation');
    expect(panelsSource).toContain("state.method === 'video' && !isNaturalRecovery");
    expect(panelsSource).toContain("!isNaturalRecovery && state.method === 'music'");
    expect(panelsSource).toContain('remainingSeconds={isWindowElapsed ? 0 : null}');
    expect(fullscreenSource).toContain('<ParticipantVideoStage');
    expect(fullscreenSource).toContain('silent');
    const fullscreenHookSource = readText(
      new URL('./useParticipantFullscreen.ts', import.meta.url),
    );
    expect(fullscreenHookSource).toContain('const appWindow = getCurrentWindow();');
    expect(fullscreenHookSource).toContain('appWindow.setFullscreen(true)');
    // Chained member calls rewrap under Prettier, so assert the exit call
    // with whitespace-tolerant matching instead of one exact line.
    expect(fullscreenHookSource).toMatch(/getCurrentWindow\(\)\s*\.\s*setFullscreen\(false\)/);
    expect(fullscreenSource).toContain('onElapsed={onWindowElapsed}');
    expect(fullscreenSource).toContain(
      "shouldPauseAt(isPlaying && finishMode.mode === 'finish' ? 0 : null)",
    );
    expect(fullscreenSource).not.toMatch(/<video[\s\S]*\bcontrols\b/);
    expect(fullscreenSource).toContain('type { ParadigmVideoEntry }');
    expect(fullscreenSource).not.toContain('getAllVideoRegulationAssets');
    expect(panelsSource).toContain('flow.isRegulationPoolLoading');
    expect(panelsSource).toContain('flow.regulationPoolStatus');
  });

  test('the player pauses at zero through the pure to-zero rule', () => {
    const playerSource = readText(new URL('./EffectRegulationPlayer.tsx', import.meta.url));
    const modelSource = readText(new URL('./effectRegulationPlayerModel.ts', import.meta.url));
    const musicHistorySource = readText(new URL('./useMusicHistory.ts', import.meta.url));

    expect(modelSource).toContain('export function shouldPauseAt(');
    expect(playerSource).toContain('remainingSeconds === 0 || interrupted');
    expect(playerSource).toContain('useMusicHistory({');
    expect(musicHistorySource).toContain('listMusicHistory(userId, limit)');
    expect(playerSource).not.toContain('useEegSession');
  });
});

describe('paradigm finished-screen handoff contract', () => {
  test('links the finished screen to the effect-evaluation route', () => {
    const finishedSource = readText(
      new URL('../../paradigm/ParadigmFinishedScreen.tsx', import.meta.url),
    );

    expect(finishedSource).toContain("navigate('/effect-evaluation')");
    expect(finishedSource).toContain('前往效果评价');
  });
});

describe('timeline / stage / review layout contract', () => {
  test('the page mounts the collapsible progress disclosure hosting the timeline, done band, and review overlay', () => {
    const pageSource = readText(pageUrl);
    const timelineSource = readText(timelineUrl);
    const reviewSource = readText(reviewUrl);
    const disclosureSource = readText(disclosureUrl);
    expect(pageSource).toContain('<EffectProgressDisclosure');
    expect(pageSource).not.toContain('<EffectTimeline');
    expect(pageSource).not.toContain('<EffectDoneBand');
    expect(disclosureSource).toContain('<EffectTimeline');
    expect(disclosureSource).toContain('<EffectDoneBand');
    expect(pageSource).toContain('scaleDialogOpen={isScaleDialogOpen}');
    expect(pageSource).toContain('<EffectReviewPopover');
    expect(pageSource).not.toContain('EffectPipelineCard');
    expect(timelineSource).toContain('onStationClick');
    expect(timelineSource).toContain('aria-current');
    expect(timelineSource).toContain('stationDotCurrent');
    expect(pageSource).toContain('scrollIntoView');
    expect(pageSource).toContain('setReview({ step, anchorEl })');
    expect(reviewSource).toContain('<Popover');
    expect(reviewSource).toContain('configChip');
    expect(reviewSource).toContain('已跳过剩余时长');
    expect(reviewSource).toContain('只读回顾');
    expect(reviewSource).not.toContain('flow.');
  });

  test('the main stage presents one task with a kicker, plain-language copy, and one primary CTA per step', () => {
    const pageSource = readText(pageUrl);
    const panelsSource = readText(panelsUrl);
    expect(pageSource).toContain('步骤 {state.step + 1} / {EFFECT_FLOW_STEP_COUNT}');
    expect(pageSource).toContain('currentNode.stageTitle');
    expect(pageSource).toContain('currentNode.stageHint');
    expect(panelsSource).toContain('前往实验设置');
    expect(readText(new URL('./EffectFullscreenInduction.tsx', import.meta.url))).toContain(
      '开始播放视频',
    );
    expect(panelsSource).toContain('开始填写');
    expect(panelsSource).toContain("'开始调控'");
    expect(panelsSource).toContain('进入全屏准备');
    expect(panelsSource).toContain('stageSecondaryRow');
    expect(panelsSource).toContain('secondaryActionDanger');
    expect(panelsSource).toContain('跳过剩余时长…');
    expect(pageSource).toContain('stageFooterRow');
    expect(pageSource).toContain('重置流程');
  });
});

describe('usability/operability fixes (audit contract)', () => {
  test('a restored result identifies the completed evaluation', () => {
    const pageSource = readText(pageUrl);
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));
    expect(hookSource).toContain('isResumedRun: storedInitialState !== null');
    expect(pageSource).toContain('flow.isResumedRun && !isResumeNoticeDismissed');
    expect(pageSource).toContain('已恢复上次完成的评价');
    expect(pageSource).toContain('可以查看结果或开始下一次实验');
    expect(pageSource).toContain('setIsResumeNoticeDismissed(true)');
  });

  test('step transitions move viewport and focus to the new stage content', () => {
    const pageSource = readText(pageUrl);
    expect(pageSource).toContain('tabIndex={-1}');
    expect(pageSource).toContain('stage.focus({ preventScroll: true })');
    expect(pageSource).toContain('hasRenderedStepRef');
  });

  test('a submission keeps its answers while saving', () => {
    const source = readText(new URL('../../mentalScale/DeqRatingDialog.tsx', import.meta.url));
    expect(source).toContain('onClose={isSubmitting ? undefined : onClose}');
    expect(source).toContain('await onComplete');
    expect(source).toContain('draft.clear');
  });

  test('history delete warns when the target feeds the in-flight run', () => {
    const panelSource = readText(new URL('./EffectHistoryPanel.tsx', import.meta.url));
    expect(panelSource).toContain('readFlowStateFromStorage(window.sessionStorage)');
    expect(panelSource).toContain('isDeleteTargetOfActiveRun');
    expect(panelSource).toContain('删除后将无法查看本次运行的量表结果');
  });
});
