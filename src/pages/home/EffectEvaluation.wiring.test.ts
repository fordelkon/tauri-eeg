// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (url: URL) => readFileSync(url, 'utf8');

const pageUrl = new URL('./EffectEvaluation.tsx', import.meta.url);
const timelineUrl = new URL('./EffectTimeline.tsx', import.meta.url);
const disclosureUrl = new URL('./EffectProgressDisclosure.tsx', import.meta.url);
const reviewUrl = new URL('./EffectReviewPopover.tsx', import.meta.url);
const panelsUrl = new URL('./EffectStepPanels.tsx', import.meta.url);
const cardsUrl = new URL('./EffectResultCards.tsx', import.meta.url);

describe('EffectEvaluation wiring contract', () => {
  test('registers /effect-evaluation outside the standalone regulation gate', () => {
    const appSource = readText(new URL('../../App.tsx', import.meta.url));

    expect(appSource).toContain("import('./pages/home/EffectEvaluation')");
    expect(appSource).toContain('path="/effect-evaluation"');
    const evaluationIndex = appSource.indexOf('path="/effect-evaluation"');
    const gateIndex = appSource.indexOf('<Route element={<ScaleGateRoute />}>');
    expect(evaluationIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeGreaterThan(evaluationIndex);
  });

  test('adds the effect-evaluation entry to the home navigation', () => {
    const homeSource = readText(new URL('../Home.tsx', import.meta.url));

    expect(homeSource).toContain(
      "{ icon: InsightsRoundedIcon, label: '效果评价', path: '/effect-evaluation' }",
    );
  });

  test('renders the battery dialog and confirm dialog on the page', () => {
    const pageSource = readText(pageUrl);
    const panelsSource = readText(panelsUrl);

    expect(panelsSource).toContain(
      "import InstrumentScaleDialog from '../../mentalScale/InstrumentScaleDialog'",
    );
    expect(pageSource).toContain("import { useConfirmDialog } from '../../ui/useConfirmDialog'");
    expect(panelsSource).toContain('<InstrumentScaleDialog');
    expect(pageSource).toContain('useConfirmDialog()');
  });

  test('measures nodes 2/4 with the shared STAI-S + PANAS battery (doc scale-instruments §1/§3.3)', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));
    const panelsSource = readText(panelsUrl);
    expect(hookSource).toContain("from '../../mentalScale/instruments/battery'");
    expect(hookSource).toContain('STAI_PANAS_BATTERY_SCALE_ID');
    expect(hookSource).toContain('buildBatteryDefinition({ includeSam: true })');
    expect(hookSource).toContain(
      "includeGems: state.method === 'music' && state.condition === 'regulation'",
    );
    expect(hookSource).toContain('const BASELINE_SCALE_DEFINITION = buildBatteryDefinition');
    expect(hookSource).toContain('buildBatteryRawAnswers(answers)');
    expect(hookSource).toContain('[...batteryDimensionKeys]');
    expect(panelsSource).toContain('definition={flow.scaleDefinitionFor(phase)}');
    expect(panelsSource).not.toContain('scaleForMethod');
  });
});

describe('subject passthrough contract', () => {
  test('saves phase records under the configured subject for both phases', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));

    expect(hookSource).toContain('await savePhaseInstrumentRecord({');
    expect(hookSource).toContain('subjectId: current.subjectId.trim()');
    expect(hookSource).toContain("phase === 'baseline'");
  });

  test('shares the validated subject with the rest of the app on setup completion', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));

    expect(hookSource).toContain(
      "import { readStoredSubjectId, writeStoredSubjectId } from '../../storage/currentSubject'",
    );
    expect(hookSource).toContain('subjectSelected: writeStoredSubjectId');
  });

  test('persists gate submissions with an explicit subject binding option', () => {
    const apiSource = readText(new URL('../../mentalScale/scaleRecordsApi.ts', import.meta.url));
    expect(apiSource).toContain('readStoredSubjectId()');
    expect(apiSource).not.toContain('subjectId: null,');
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
  test('F1: submissions mark measured dimensions and the mean basis is surfaced', () => {
    const apiSource = readText(new URL('../../mentalScale/scaleRecordsApi.ts', import.meta.url));
    const statusSource = readText(
      new URL('../../mentalScale/mentalScaleStatus.ts', import.meta.url),
    );
    const pageSource = readText(pageUrl);
    const cardsSource = readText(cardsUrl);
    expect(apiSource).toContain('measuredDimensionKeys(scale, answers)');
    expect(statusSource).toContain('export function measuredDimensionKeys');
    expect(cardsSource).toContain('实际纳入对比的维度数');
    expect(pageSource).toContain('describeMeasuredBasis(flow.summary)');
  });

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
  test('the setup step selects the run condition and the induction step gates on the pool', () => {
    const panelsSource = readText(panelsUrl);
    expect(panelsSource).toContain('EFFECT_CONDITION_OPTIONS');
    expect(panelsSource).toContain('实验条件');
    expect(panelsSource).toContain('condition: value');
    expect(panelsSource).toContain('基线条件（自然恢复）＝情绪诱发后不施加调控手段');
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
    expect(panelsSource).toContain("'结束静息，进行复测'");
    expect(panelsSource).toContain('flow.openRegulationPage');
    expect(panelsSource).toMatch(/isNaturalRecovery \? null : \(\s*<button/);
    expect(flowSource).toContain("state.condition !== 'regulation'");
  });

  test('the result step renders the cross-condition comparison card', () => {
    const pageSource = readText(pageUrl);
    const cardsSource = readText(cardsUrl);
    const chartSource = readText(new URL('./effectResultChartOption.ts', import.meta.url));
    const reportsSource = readText(new URL('./useEffectResultReports.ts', import.meta.url));
    expect(reportsSource).toContain('computeComparison: computeConditionEffect');
    expect(pageSource).toContain('conditionComparison');
    expect(pageSource).toContain('buildConditionComparisonVerdictCopy');
    expect(pageSource).toContain('buildConditionComparisonChartOption');
    expect(cardsSource).toContain('CONDITION_COMPARISON_FORMULA_NOTE');
    expect(cardsSource).toContain('需完成基线条件（自然恢复）与调控条件各一次完整评价');
    expect(cardsSource).toContain('跨条件平均改善率');
    expect(cardsSource).toContain('基线条件 · 条件后');
    expect(chartSource).toContain('buildConditionComparisonChartOption');
  });
});

describe('comparison export, leg trace & induction fallback (R7 contract)', () => {
  test("the comparison card renders both legs' record trace and export buttons", () => {
    const pageSource =
      readText(pageUrl) + readText(new URL('./useEffectReportExports.ts', import.meta.url));
    const cardsSource = readText(cardsUrl);
    const exportSource = readText(new URL('./effectReportExport.ts', import.meta.url));
    const apiSource = readText(new URL('../../mentalScale/scaleRecordsApi.ts', import.meta.url));
    expect(cardsSource).toContain('renderComparisonLegTrace');
    expect(cardsSource).toContain('conditionComparison.naturalRecoveryLeg');
    expect(cardsSource).toContain('conditionComparison.regulationLeg');
    expect(cardsSource).toContain('formatRunTimestamp');
    expect(pageSource).toContain("runComparisonExport('json')");
    expect(pageSource).toContain("runComparisonExport('csv')");
    expect(pageSource).toContain('buildComparisonReportPayload');
    expect(exportSource).toContain('effect-comparison-');
    expect(apiSource).toContain("kind: 'comparison'");
  });

  test('the backend leg shape travels into the view types', () => {
    const apiSource = readText(new URL('../../mentalScale/scaleRecordsApi.ts', import.meta.url));
    expect(apiSource).toContain('naturalRecoveryLeg: ConditionComparisonLegView');
    expect(apiSource).toContain('regulationLeg: ConditionComparisonLegView');
  });

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

  test("the history panel shows each run's condition with a legacy tag", () => {
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
    expect(inductionStageSource).toContain('准备播放诱发视频');
    expect(inductionStageSource).toContain('开始播放诱发视频');
    expect(regulationStageSource).toContain('准备播放调控视频');
    expect(regulationStageSource).toContain('开始播放调控视频');
    expect(inductionStageSource).toContain('正在预载诱发素材');
    expect(regulationStageSource).toContain('正在预载平静调控素材');
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
    expect(fullscreenSource).toContain('createPortal(');
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
    const modelSource = readText(new URL('./effectPipeline.ts', import.meta.url));
    expect(pageSource).toContain('步骤 {state.step + 1} / {EFFECT_FLOW_STEP_COUNT}');
    expect(pageSource).toContain('currentNode.stageTitle');
    expect(pageSource).toContain('currentNode.stageHint');
    expect(modelSource).toContain("stageTitle: '设置本次实验'");
    expect(panelsSource).toContain('确认配置，开始诱发');
    expect(readText(new URL('./EffectFullscreenInduction.tsx', import.meta.url))).toContain(
      '开始播放诱发视频',
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
  test('a resumed mid-run state announces itself instead of restoring silently', () => {
    const pageSource = readText(pageUrl);
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));
    expect(hookSource).toContain('isResumedRun: storedInitialState !== null');
    expect(pageSource).toContain('flow.isResumedRun && !isResumeNoticeDismissed');
    expect(pageSource).toContain('已恢复上次进行中的评价');
    expect(pageSource).toContain('条件计时按真实时间继续计算');
    expect(pageSource).toContain('setIsResumeNoticeDismissed(true)');
  });

  test('step transitions move viewport and focus to the new stage content', () => {
    const pageSource = readText(pageUrl);
    expect(pageSource).toContain('tabIndex={-1}');
    expect(pageSource).toContain('stage.focus({ preventScroll: true })');
    expect(pageSource).toContain('hasRenderedStepRef');
  });

  test('the scale dialog stays open while the record saves (draft survives failure)', () => {
    const panelsSource = readText(panelsUrl);
    const dialogSource = readText(
      new URL('../../mentalScale/InstrumentScaleDialog.tsx', import.meta.url),
    );
    expect(panelsSource).toContain('isSubmitting={flow.isSavingScale}');
    expect(panelsSource).toContain('submitError={flow.actionError}');
    expect(panelsSource).not.toContain(
      'onCloseDialog();\n            void flow.completeScaleMeasurement',
    );
    expect(dialogSource).toContain('isSubmitting?: boolean');
    expect(dialogSource).toContain('submitError?: string | null');
    expect(dialogSource).toContain("isSubmitting ? '正在保存量表…' : '提交量表'");
    expect(dialogSource).toContain('role="alert"');
  });

  test('the hand-rolled scale overlay traps focus and closes guarded', () => {
    const dialogSource = readText(
      new URL('../../mentalScale/InstrumentScaleDialog.tsx', import.meta.url),
    );
    expect(dialogSource).toContain('openerElementRef');
    expect(dialogSource).toContain("event.key === 'Escape'");
    expect(dialogSource).toContain("event.key !== 'Tab'");
    expect(dialogSource).toContain('handleCloseRequest()');
  });

  test('scale anchor rows navigate (and select) with the keyboard', () => {
    const anchorSource = readText(
      new URL('../../mentalScale/scaleUi/ScaleAnchorGroup.tsx', import.meta.url),
    );
    expect(anchorSource).toContain("case 'ArrowLeft':");
    expect(anchorSource).toContain("case 'ArrowRight':");
    expect(anchorSource).toContain("case 'Home':");
    expect(anchorSource).toContain('selectAnchorValue(onSelect, next)');
  });

  test('history delete warns when the target feeds the in-flight run', () => {
    const panelSource = readText(new URL('./EffectHistoryPanel.tsx', import.meta.url));
    expect(panelSource).toContain('readFlowStateFromStorage(window.sessionStorage)');
    expect(panelSource).toContain('isDeleteTargetOfActiveRun');
    expect(panelSource).toContain('删除后本次运行的改善率与跨条件对比将无法计算');
  });
});
