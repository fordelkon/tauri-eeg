// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (url: URL) => readFileSync(url, 'utf8');

/**
 * Wiring contracts for the effect-evaluation loop (R2): routing, home
 * navigation, subject passthrough into persistence, and the missing-record
 * guard. Source-contract style matches MusicRegulation.behavior.test.ts so
 * these stay runnable in the plain-node vitest environment.
 *
 * The pipeline refactor split the former single wizard page into a page
 * layer: EffectEvaluation.tsx (board, context, exports), EffectStepPanels.tsx
 * (the per-step interaction areas) and EffectResultCards.tsx (result /
 * comparison cards). Contracts below read the file the covered markup
 * actually lives in.
 */

const pageUrl = new URL('./EffectEvaluation.tsx', import.meta.url);
const panelsUrl = new URL('./EffectStepPanels.tsx', import.meta.url);
const cardsUrl = new URL('./EffectResultCards.tsx', import.meta.url);

describe('EffectEvaluation wiring contract', () => {
  test('registers /effect-evaluation outside the standalone regulation gate', () => {
    const appSource = readText(new URL('../../App.tsx', import.meta.url));

    expect(appSource).toContain("import('./pages/home/EffectEvaluation')");
    expect(appSource).toContain('path="/effect-evaluation"');
    // The wizard orchestrates its own baseline/post phases, so it must sit
    // before the ScaleGateRoute block rather than inside it.
    const evaluationIndex = appSource.indexOf('path="/effect-evaluation"');
    const gateIndex = appSource.indexOf('<Route element={<ScaleGateRoute />}>');
    expect(evaluationIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeGreaterThan(evaluationIndex);
  });

  test('adds the effect-evaluation entry to the home navigation', () => {
    const homeSource = readText(new URL('../Home.tsx', import.meta.url));

    expect(homeSource).toContain("{ icon: InsightsRoundedIcon, label: '效果评价', path: '/effect-evaluation' }");
  });

  test('renders the battery dialog and confirm dialog on the page', () => {
    const pageSource = readText(pageUrl);
    const panelsSource = readText(panelsUrl);

    expect(panelsSource).toContain("import InstrumentScaleDialog from '../../mentalScale/InstrumentScaleDialog'");
    expect(pageSource).toContain("import { useConfirmDialog } from '../../ui/useConfirmDialog'");
    expect(panelsSource).toContain('<InstrumentScaleDialog');
    expect(pageSource).toContain('useConfirmDialog()');
  });

  test('measures nodes 2/4 with the shared STAI-S + PANAS battery (doc scale-instruments §1/§3.3)', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));
    const panelsSource = readText(panelsUrl);

    // The same battery core for both phases and every method: the instrument
    // is imported from the battery module, not looked up per regulation method.
    expect(hookSource).toContain("from '../../mentalScale/instruments/battery'");
    expect(hookSource).toContain('STAI_PANAS_BATTERY_SCALE_ID');
    // The auxiliary scales ride the battery record instead of their own rows
    // (doc §3.3): SAM prepends the baseline leg (node ②), GEMS-9 joins the
    // post leg (node ④) for the music condition only.
    expect(hookSource).toContain("buildBatteryDefinition({ includeSam: true })");
    expect(hookSource).toContain("buildBatteryDefinition({ includeGems: state.method === 'music' })");
    expect(hookSource).toContain('const BASELINE_SCALE_DEFINITION = buildBatteryDefinition');
    // Raw answers travel in the doc §3.3 shape {stai, panas, timeframe: now}
    // (sam/gems sub-objects added by the battery module when enabled) and the
    // measured marker covers all three battery dimensions.
    expect(hookSource).toContain('buildBatteryRawAnswers(answers)');
    expect(hookSource).toContain('[...batteryDimensionKeys]');

    // The panel feeds the per-phase battery definition into the instrument
    // dialog and the answers straight into the phase save (no per-method
    // scale branch).
    expect(panelsSource).toContain('definition={flow.scaleDefinitionFor(phase)}');
    expect(panelsSource).not.toContain('scaleForMethod');
  });
});

describe('subject passthrough contract', () => {
  test('saves phase records under the configured subject for both phases', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));

    expect(hookSource).toContain('await savePhaseInstrumentRecord({');
    expect(hookSource).toContain('subjectId: state.subjectId.trim()');
    expect(hookSource).toContain("phase === 'baseline'");
  });

  test('shares the validated subject with the rest of the app on setup completion', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));

    expect(hookSource).toContain("import { writeStoredSubjectId } from '../../storage/currentSubject'");
    expect(hookSource).toContain('writeStoredSubjectId(state.subjectId.trim())');
  });

  test('blocks the summary on missing measurements instead of invoking the backend', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));
    const guardIndex = hookSource.indexOf('describeMissingMeasurements(state)');
    const computeIndex = hookSource.indexOf('computeRegulationEffect(baselineRecordId');

    // The guard must short-circuit before any backend call.
    expect(guardIndex).toBeGreaterThan(-1);
    expect(computeIndex).toBeGreaterThan(guardIndex);
    expect(hookSource).toContain('if (missingCopy)');
  });

  test('persists gate submissions with an explicit subject binding option', () => {
    const apiSource = readText(new URL('../../mentalScale/scaleRecordsApi.ts', import.meta.url));

    // R2: records no longer hard-code subjectId null — explicit binding wins,
    // otherwise the shared subject memory is consulted.
    expect(apiSource).toContain('readStoredSubjectId()');
    expect(apiSource).not.toContain('subjectId: null,');
  });
});

describe('strong duration constraint (R3 contract)', () => {
  test('locks the finish exit until zero and routes early exits through a confirmed skip', () => {
    const pageSource = readText(pageUrl);
    const panelsSource = readText(panelsUrl);
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));

    // The page derives the exit mode from the remaining countdown…
    expect(pageSource).toContain('regulationFinishModeFromRemaining(flow.remainingSeconds)');
    // …disables the primary exit while time remains…
    expect(panelsSource).toContain("disabled={finishMode.mode !== 'finish'}");
    // …and offers the escape hatch only through a second confirmation. R6
    // swaps the noun by condition: 静息 for natural recovery, 调控 otherwise.
    expect(pageSource).toContain('title: `跳过剩余${windowNoun}时长？`');
    expect(pageSource).toContain("const windowNoun = isNaturalRecovery ? '静息' : '调控'");
    expect(pageSource).toContain('destructive: true');

    // The confirmed skip records the marker before leaving step 3.
    expect(hookSource).toContain('skipRemainingRegulation');
    expect(hookSource).toContain('leaveRegulationStep({ regulationSkipped: true })');
  });

  test('persists emotion, duration, and the post-leg skip marker with phase records', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));

    expect(hookSource).toContain('emotion: state.emotion');
    expect(hookSource).toContain('durationMinutes: state.durationMinutes');
    expect(hookSource).toContain("phase === 'post' ? state.regulationSkipped : false");
  });
});

describe('report export & history review (R3 contract)', () => {
  test('exports single/batch reports through the save dialog and backend command', () => {
    const pageSource = readText(pageUrl);

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

    // The panel reads history through the shared API layer.
    expect(panelSource).toContain("'../../mentalScale/scaleRecordsApi'");
  });
});

describe('measured dimensions & eeg persistence (R4 contract)', () => {
  test('F1: submissions mark measured dimensions and the mean basis is surfaced', () => {
    const apiSource = readText(new URL('../../mentalScale/scaleRecordsApi.ts', import.meta.url));
    const statusSource = readText(new URL('../../mentalScale/mentalScaleStatus.ts', import.meta.url));
    const pageSource = readText(pageUrl);
    const cardsSource = readText(cardsUrl);

    // Both save paths derive the marker from the actually answered questions.
    expect(apiSource).toContain('measuredDimensionKeys(scale, answers)');
    expect(statusSource).toContain('export function measuredDimensionKeys');
    // The result page states the honest comparison-basis count and flags
    // legacy pairs computed over every stored key.
    expect(cardsSource).toContain('实际纳入对比的维度数');
    expect(pageSource).toContain('describeMeasuredBasis(flow.summary)');
  });

  test('F2: the post leg persists the eeg session id and both views show it', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));
    const cardsSource = readText(cardsUrl);
    const panelSource = readText(new URL('./EffectHistoryPanel.tsx', import.meta.url));

    // The association rides on the post record so it survives restarts.
    expect(hookSource).toContain("eegSessionId: phase === 'post' ? state.eegSessionId : null");
    expect(cardsSource).toContain('关联 EEG 会话');
    expect(panelSource).toContain('EEG 会话');

    // The save callback must re-read the session id captured after the
    // recording stopped — without the dep, an in-place run (no jump to the
    // regulation page) persists a stale null.
    const saveIndex = hookSource.indexOf('const completeScaleMeasurement');
    const depIndex = hookSource.indexOf('state.eegSessionId,', saveIndex);
    expect(saveIndex).toBeGreaterThan(-1);
    expect(depIndex).toBeGreaterThan(saveIndex);
  });

  test('F3: resetting the flow stops a live recording before clearing state', () => {
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));

    const resetIndex = hookSource.indexOf('const resetFlow');
    const stopIndex = hookSource.indexOf('void stopRecord();', resetIndex);
    const clearStateIndex = hookSource.indexOf('setState(createEffectEvaluationFlowState());');

    expect(resetIndex).toBeGreaterThan(-1);
    expect(stopIndex).toBeGreaterThan(resetIndex);
    expect(clearStateIndex).toBeGreaterThan(stopIndex);
    // An in-flight start from a discarded run must not leak into the fresh
    // state (generation token checked inside the start callback).
    expect(hookSource).toContain('flowGenerationRef.current !== generation');
    expect(hookSource).toContain('flowGenerationRef.current += 1;');

    // Unmounting off the designed regulation-path jump mid-recording stops
    // the recording too (sidebar abandonment would otherwise leak an unowned
    // one). R6: only the regulation condition's live window counts as the
    // designed jump - a natural-recovery run never leaves the wizard page.
    expect(hookSource).toContain(
      'window.location.pathname === regulationPathForMethod(methodRef.current)',
    );
    expect(hookSource).toContain("flowStateRef.current.condition === 'regulation'");
    expect(hookSource).toContain('isRegulationWindowOpen(flowStateRef.current)');
  });

  test('F4: regulation pages consume the session context and the paradigm gate is mutual', () => {
    for (const page of ['./MusicRegulation.tsx', './VideoRegulation.tsx'] as const) {
      const source = readText(new URL(page, import.meta.url));

      expect(source).toContain('useEffectRegulationContext(');
      expect(source).toContain('effectSessionBanner');
      expect(source).toContain('效果评价调控时长已达成');
    }

    const paradigmSource = readText(
      new URL('../../eeg/paradigm/ParadigmSetupPanel.tsx', import.meta.url),
    );
    expect(paradigmSource).toContain('isRegulationWindowOpenInStorage(window.sessionStorage)');
    expect(paradigmSource).toContain('效果评价调控进行中');
  });
});

describe('six-step flow & condition split (R6 contract)', () => {
  test('the setup step selects the run condition and the induction step gates on the pool', () => {
    const panelsSource = readText(panelsUrl);
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));

    // The setup step offers both outline conditions with explanation copy.
    expect(panelsSource).toContain('EFFECT_CONDITION_OPTIONS');
    expect(panelsSource).toContain('实验条件');
    expect(panelsSource).toContain('condition: value');
    expect(panelsSource).toContain('基线条件（自然恢复）＝情绪诱发后不施加调控手段');

    // The induction step renders the pure pool status (blocked copy is never
    // silently skipped) and plays the picked entry through the same
    // video_paradigm URL conversion the acquisition page uses.
    expect(hookSource).toContain('describeInductionPoolStatus');
    expect(panelsSource).toContain('flow.inductionStatus');
    expect(panelsSource).toContain('status.copy');
    expect(panelsSource).toContain('toPlayableVideoUrl(status.entry.absolutePath, convertFileSrc)');
    // The induction completion advances only when the video actually ended.
    expect(panelsSource).toContain('onEnded={() => flow.completeInduction()}');
  });

  test('the natural-recovery condition runs its countdown inside the wizard page', () => {
    const pageSource = readText(pageUrl);
    const panelsSource = readText(panelsUrl);
    const flowSource = readText(new URL('./effectEvaluationFlow.ts', import.meta.url));

    // The page branches the condition step on the wizard condition…
    expect(pageSource).toContain("state.condition === 'natural_recovery'");
    // …renders the in-page rest countdown (静息 copy, strong duration
    // constraint, confirmed skip)…
    expect(panelsSource).toContain("'开始静息'");
    expect(panelsSource).toContain("'结束静息，进行复测'");
    // …and keeps the regulation-page jump inside the regulation branch only.
    expect(panelsSource).toContain('flow.openRegulationPage');
    expect(panelsSource).toContain("isNaturalRecovery ? null : (");

    // The pure module keeps the regulation-page context null for
    // natural-recovery windows so those pages never see a banner.
    expect(flowSource).toContain("state.condition !== 'regulation'");
  });

  test('the result step renders the cross-condition comparison card', () => {
    const pageSource = readText(pageUrl);
    const cardsSource = readText(cardsUrl);
    const chartSource = readText(new URL('./effectResultChartOption.ts', import.meta.url));
    const hookSource = readText(new URL('./useEffectEvaluationFlow.ts', import.meta.url));

    // The hook fetches the backend cross-condition summary on the result step…
    expect(hookSource).toContain('computeConditionEffect(state.subjectId.trim(), state.emotion)');
    // …and the page renders the verdict, stats, chart, table, and the frozen
    // formula note, plus guidance copy when a condition is still missing.
    expect(pageSource).toContain('conditionComparison');
    expect(pageSource).toContain('buildConditionComparisonVerdictCopy');
    expect(pageSource).toContain('buildConditionComparisonChartOption');
    expect(cardsSource).toContain('CONDITION_COMPARISON_FORMULA_NOTE');
    expect(cardsSource).toContain('需完成基线条件（自然恢复）与调控条件各一次完整评价');
    expect(cardsSource).toContain('跨条件平均改善率');
    expect(cardsSource).toContain('基线条件 post');
    expect(chartSource).toContain('buildConditionComparisonChartOption');
  });
});

describe('comparison export, leg trace & induction fallback (R7 contract)', () => {
  test('the comparison card renders both legs\' record trace and export buttons', () => {
    const pageSource = readText(pageUrl);
    const cardsSource = readText(cardsUrl);
    const exportSource = readText(new URL('./effectReportExport.ts', import.meta.url));
    const apiSource = readText(new URL('../../mentalScale/scaleRecordsApi.ts', import.meta.url));

    // 大纲 6.3 步骤 5: the pairing is auditable on screen - both legs'
    // post-record ids and timestamps come from the backend comparison.
    expect(cardsSource).toContain('renderComparisonLegTrace');
    // The comparison card is a memoized component that receives the paired
    // runs as a prop, so the legs are read off `conditionComparison` there.
    expect(cardsSource).toContain('conditionComparison.naturalRecoveryLeg');
    expect(cardsSource).toContain('conditionComparison.regulationLeg');
    expect(cardsSource).toContain('formatRunTimestamp');

    // The export rides the existing save-dialog flow with its own payload
    // builder and file-name family.
    expect(pageSource).toContain("runComparisonExport('json')");
    expect(pageSource).toContain("runComparisonExport('csv')");
    expect(pageSource).toContain('buildComparisonReportPayload');
    expect(exportSource).toContain('effect-comparison-');
    expect(apiSource).toContain("kind: 'comparison'");
  });

  test('the backend leg shape travels into the view types', () => {
    const apiSource = readText(new URL('../../mentalScale/scaleRecordsApi.ts', import.meta.url));

    // The camelCase mirror of the backend ConditionComparisonLeg keeps the
    // record ids, timestamps, and run facts typed for the card.
    expect(apiSource).toContain('naturalRecoveryLeg: ConditionComparisonLegView');
    expect(apiSource).toContain('regulationLeg: ConditionComparisonLegView');
  });

  test('a failed induction video offers a retry and a way back to the setup step', () => {
    const pageSource = readText(pageUrl);
    const panelsSource = readText(panelsUrl);

    // R7, feedback-003 P2-3: only onEnded advances the flow, so a load
    // failure needs its own branch - no silent dead end on step 1.
    expect(panelsSource).toContain("inductionVideoFailed && status.kind === 'ready'");
    // The panel marks the failure through the page-owned callback (the
    // setter itself stays on the page with the other player state).
    expect(panelsSource).toContain('onError={onVideoError}');
    expect(pageSource).toContain('setInductionVideoFailed(true)');
    expect(panelsSource).toContain('重试加载素材');
    expect(panelsSource).toContain('重置并返回设置步');
    // The retry remounts a fresh element (the counter rides on the key).
    expect(panelsSource).toContain('`${status.entry.videoId}-${inductionRetryCount}`');
  });

  test('the history panel shows each run\'s condition with a legacy tag', () => {
    const panelSource = readText(new URL('./EffectHistoryPanel.tsx', import.meta.url));
    const viewSource = readText(new URL('./effectHistoryView.ts', import.meta.url));

    // R7, feedback-003 P2-1: the row chip distinguishes natural-recovery /
    // regulation / legacy runs.
    expect(panelSource).toContain('labelForHistoryCondition(entry.condition)');
    expect(viewSource).toContain('export function labelForHistoryCondition');
  });
});

describe('embedded regulation player (condition node contract)', () => {
  test('hosts the player inside the condition panel for the regulation branch only', () => {
    const panelsSource = readText(panelsUrl);

    // The condition card embeds the media player (the main path) and keeps
    // the standalone-page button side by side; the natural-recovery
    // condition has no media and never mounts a player.
    expect(panelsSource).toContain("import EffectRegulationPlayer from './EffectRegulationPlayer'");
    expect(panelsSource).toContain('<EffectRegulationPlayer');
    expect(panelsSource).toContain('remainingSeconds={flow.remainingSeconds}');
    expect(panelsSource).toContain('!isNaturalRecovery ? (\n            <EffectRegulationPlayer');
    expect(panelsSource).toContain('onClick={flow.openRegulationPage}');
  });

  test('the player pauses at zero through the pure to-zero rule', () => {
    const playerSource = readText(new URL('./EffectRegulationPlayer.tsx', import.meta.url));
    const modelSource = readText(new URL('./effectRegulationPlayerModel.ts', import.meta.url));

    expect(modelSource).toContain('export function shouldPauseAt(');
    expect(playerSource).toContain('shouldPauseAt(remainingSeconds)');
    // The music branch consumes the existing history command; no backend
    // surface was added for the embedded player.
    expect(playerSource).toContain("listMusicHistory(currentUser.id, MUSIC_HISTORY_PLAYER_LIMIT)");
    expect(playerSource).toContain("navigate('/music-regulation')");
  });
});

describe('context strip device quick-start contract', () => {
  test('offers one-click start when not streaming and a retry entry on error', () => {
    const pageSource = readText(pageUrl);
    const quickStartSource = readText(new URL('./EffectDeviceQuickStart.tsx', import.meta.url));

    // The context strip mounts the quick-start component…
    expect(pageSource).toContain('<EffectDeviceQuickStart />');
    // …which triggers the context's own actions only (no extra polling):
    // streaming confirmation arrives through the eeg://status event mirror.
    expect(quickStartSource).toContain('useEegSession()');
    expect(quickStartSource).toContain("eeg.deviceStatus === 'streaming'");
    expect(quickStartSource).toContain('一键启动设备');
    expect(quickStartSource).toContain('void eeg.startDevice()');
    expect(quickStartSource).toContain("eeg.deviceStatus === 'error'");
    expect(quickStartSource).toContain('void eeg.retryLastFailedAction()');
  });
});

describe('paradigm finished-screen handoff contract', () => {
  test('links the finished screen to the effect-evaluation route', () => {
    const runnerSource = readText(new URL('../../eeg/paradigm/ParadigmRunner.tsx', import.meta.url));

    expect(runnerSource).toContain("navigate('/effect-evaluation')");
    expect(runnerSource).toContain('前往效果评价');
  });
});
