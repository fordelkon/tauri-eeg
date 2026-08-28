import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { save } from '@tauri-apps/plugin-dialog';
import type { EChartsType } from 'echarts/core';
import { getParadigmSessionStatus } from '../../eeg/paradigm/paradigmSessionStatus';
import MentalScaleDialog from '../../mentalScale/MentalScaleDialog';
import { exportEffectReport } from '../../mentalScale/scaleRecordsApi';
import { useConfirmDialog } from '../../ui/useConfirmDialog';
import { describeFriendlyError } from '../../ui/friendlyError';
import { toPlayableVideoUrl } from '../../video/videoRegulationCatalog';
import {
  buildConditionComparisonVerdictCopy,
  buildEffectVerdictCopy,
  CONDITION_COMPARISON_FORMULA_NOTE,
  describeMeasuredBasis,
  describeRegulationSkipped,
  EFFECT_CONDITION_OPTIONS,
  EFFECT_EMOTION_OPTIONS,
  EFFECT_FLOW_STEPS,
  EFFECT_METHOD_OPTIONS,
  formatCountdown,
  formatImprovementRate,
  labelForCondition,
  labelForDimension,
  regulationDurationMs,
  regulationFinishModeFromRemaining,
} from './effectEvaluationFlow';
import {
  buildBatchReportPayload,
  buildSingleReportPayload,
  suggestReportFileName,
  type ExportReportFormat,
} from './effectReportExport';
import {
  buildConditionComparisonChartOption,
  buildEffectChartOption,
} from './effectResultChartOption';
import EffectHistoryPanel from './EffectHistoryPanel';
import { useEffectEvaluationFlow } from './useEffectEvaluationFlow';
import styles from './EffectEvaluation.module.css';

const DURATION_MINUTE_OPTIONS = [1, 3, 5, 10, 15, 30] as const;

type PageTab = 'wizard' | 'history';

type ExportNotice = {
  severity: 'success' | 'error';
  text: string;
};

/** Bar chart for the baseline/post comparison; echarts loads on demand. */
function EffectResultChart({
  option,
  ariaLabel,
}: {
  option: Record<string, unknown>;
  ariaLabel?: string;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<EChartsType | null>(null);
  const [isChartReady, setIsChartReady] = useState(false);

  useEffect(() => {
    if (!chartRef.current) {
      return undefined;
    }

    let cancelled = false;
    let resizeCleanup: (() => void) | undefined;

    void import('./effectResultChart').then(({ default: echarts }) => {
      if (cancelled || !chartRef.current) {
        return;
      }

      const chart = echarts.init(chartRef.current);
      chartInstanceRef.current = chart;
      setIsChartReady(true);

      const handleResize = () => chart.resize();
      window.addEventListener('resize', handleResize, { passive: true });
      resizeCleanup = () => window.removeEventListener('resize', handleResize);
    });

    return () => {
      cancelled = true;
      resizeCleanup?.();
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isChartReady) {
      return;
    }

    chartInstanceRef.current?.setOption(option, true);
  }, [isChartReady, option]);

  return (
    <div
      ref={chartRef}
      className={styles.chartWrap}
      role="img"
      aria-label={ariaLabel ?? '基线与调控后量表得分对比图'}
    />
  );
}

type PillGroupProps<T extends string> = {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  selectedValue: T;
  onSelect: (value: T) => void;
};

function PillGroup<T extends string>({
  label,
  options,
  selectedValue,
  onSelect,
}: PillGroupProps<T>) {
  return (
    <div className={styles.pillRow} role="radiogroup" aria-label={label}>
      <span className={styles.pillLabel}>{label}</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={selectedValue === option.value}
          className={`${styles.pillRadio} ${selectedValue === option.value ? styles.isSelected : ''}`}
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function EffectEvaluation() {
  const flow = useEffectEvaluationFlow();
  const { state } = flow;
  const { confirm, confirmDialogElement } = useConfirmDialog();
  // Steps 2/4 present the shared gate dialog on demand; closing it only
  // dismisses the dialog, it never touches the flow itself.
  const [isScaleDialogOpen, setIsScaleDialogOpen] = useState(false);
  // The induction video only mounts after the operator explicitly starts the
  // induction (EEG association + paradigm-session guard ride on that entry).
  const [isInductionPlaying, setIsInductionPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<PageTab>('wizard');
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<ExportNotice | null>(null);

  const emotionLabel = EFFECT_EMOTION_OPTIONS.find(
    (option) => option.value === state.emotion,
  )?.label ?? state.emotion;
  const methodLabel = EFFECT_METHOD_OPTIONS.find(
    (option) => option.value === state.method,
  )?.label ?? state.method;
  const isNaturalRecovery = state.condition === 'natural_recovery';

  // Leaving the induction step (or resetting the flow) unmounts the player.
  useEffect(() => {
    if (state.step !== 1) {
      setIsInductionPlaying(false);
    }
  }, [state.step]);

  // Strong duration constraint (R3): the countdown is a hard floor - the
  // normal finish unlocks only at zero, earlier exits go through the
  // double-confirmed skip which records the marker with the run. The same
  // constraint guards both R6 conditions (regulation jump / in-page rest).
  const finishMode = regulationFinishModeFromRemaining(flow.remainingSeconds);
  const skippedCopy = describeRegulationSkipped(state);
  // Noun swapped in the countdown copy: 静息 for the natural-recovery
  // condition, 调控 for the regulation condition.
  const windowNoun = isNaturalRecovery ? '静息' : '调控';

  const verdictCopy = useMemo(
    () => (flow.summary ? buildEffectVerdictCopy(flow.summary) : null),
    [flow.summary],
  );
  // R4/F1 口径: marker-based means need no extra copy; legacy pairs computed
  // over every stored key are flagged so the compared-dimension count is not
  // mistaken for "all four dimensions were measured".
  const measuredBasisNote = flow.summary ? describeMeasuredBasis(flow.summary) : null;
  const chartOption = useMemo(
    () => (flow.summary && flow.summary.dimensions.length > 0
      ? buildEffectChartOption(flow.summary)
      : null),
    [flow.summary],
  );

  // Cross-condition comparison (R6, 大纲 6.2): verdict, basis note, chart.
  const comparisonVerdictCopy = useMemo(
    () => (flow.conditionComparison
      ? buildConditionComparisonVerdictCopy(flow.conditionComparison)
      : null),
    [flow.conditionComparison],
  );
  const comparisonMeasuredBasisNote = flow.conditionComparison
    ? describeMeasuredBasis(flow.conditionComparison)
    : null;
  const comparisonChartOption = useMemo(
    () => (flow.conditionComparison && flow.conditionComparison.dimensions.length > 0
      ? buildConditionComparisonChartOption(flow.conditionComparison)
      : null),
    [flow.conditionComparison],
  );

  /** Normal exit - only offered once the countdown reached zero. */
  const handleFinishRegulation = () => {
    if (finishMode.mode === 'finish') {
      void flow.finishRegulation();
    }
  };

  /** Escape hatch requiring a second confirmation; marks the run as skipped. */
  const handleSkipRemaining = () => {
    if (finishMode.mode !== 'requires-skip') {
      return;
    }

    void confirm({
      title: `跳过剩余${windowNoun}时长？`,
      description: `${windowNoun}计时还剩 ${formatCountdown(finishMode.remainingSeconds)}，未达设定的最短时长。跳过后本次评价会记录“已跳过”标记，改善率可能低估实际效果。确定跳过并进入复测吗？`,
      confirmText: '确认跳过',
      destructive: true,
    }).then((confirmed) => {
      if (confirmed) {
        void flow.skipRemainingRegulation();
      }
    });
  };

  /** Step 1 entry: starts the EEG association, then mounts the player. */
  const handleBeginInduction = () => {
    if (flow.inductionStatus.kind !== 'ready') {
      return;
    }

    flow.beginInduction();

    // A live paradigm session blocks the EEG association (the hook shows its
    // own error banner); the video must not start behind that guard either.
    if (!getParadigmSessionStatus().active) {
      setIsInductionPlaying(true);
    }
  };

  const runSingleExport = async (format: ExportReportFormat) => {
    setExportNotice(null);
    setIsExporting(true);

    try {
      const path = await save({
        title: format === 'csv' ? '导出单次报告（CSV）' : '导出单次报告（JSON）',
        defaultPath: suggestReportFileName({ kind: 'single', format, subjectId: state.subjectId }),
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });

      if (typeof path !== 'string') {
        return;
      }

      const result = await exportEffectReport(buildSingleReportPayload({
        baselineRecordId: state.baselineRecordId,
        postRecordId: state.postRecordId,
        path,
        format,
      }));
      setExportNotice({ severity: 'success', text: `单次报告已导出：${result.path}` });
    } catch (error) {
      setExportNotice({ severity: 'error', text: describeFriendlyError(error, '导出单次报告') });
    } finally {
      setIsExporting(false);
    }
  };

  const runBatchExport = async () => {
    setExportNotice(null);
    setIsExporting(true);

    try {
      const path = await save({
        title: '批量汇总导出（所有被试最近一次评价）',
        defaultPath: suggestReportFileName({ kind: 'batch' }),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });

      if (typeof path !== 'string') {
        return;
      }

      const result = await exportEffectReport(buildBatchReportPayload({ path }));
      setExportNotice({ severity: 'success', text: `批量汇总已导出：${result.path}` });
    } catch (error) {
      setExportNotice({ severity: 'error', text: describeFriendlyError(error, '导出批量汇总') });
    } finally {
      setIsExporting(false);
    }
  };

  const configSummary = (
    <div className={styles.configSummary}>
      <span className={styles.configChip}>被试 {state.subjectId.trim() || '未填写'}</span>
      <span className={styles.configChip}>目标情绪 {emotionLabel}</span>
      <span className={styles.configChip}>{methodLabel}</span>
      <span className={styles.configChip}>{labelForCondition(state.condition)}</span>
    </div>
  );

  /** EEG association chip shared by the induction and condition steps. */
  const renderEegAssociationChip = () => {
    if (state.eegAssociation === 'not-started') {
      return null;
    }

    return (
      <div className={styles.pillRow}>
        <span
          className={`${styles.eegChip} ${
            state.eegAssociation === 'saved'
              ? styles.eegSaved
              : state.eegAssociation === 'recording'
                ? styles.eegRecording
                : styles.eegUnavailable
          }`}
        >
          {state.eegAssociation === 'saved'
            ? `EEG 记录已保存${state.eegSessionId ? `（会话 ${`${state.eegSessionId.slice(0, 8)}…`}）` : ''}`
            : state.eegAssociation === 'recording'
              ? '正在关联 EEG 记录'
              : '设备不可用，本次未关联 EEG 记录'}
        </span>
      </div>
    );
  };

  const renderSetupStep = () => (
    <section className={styles.panel} aria-label="选择被试与评价配置">
      <h2 className={styles.panelTitle}>选择被试</h2>
      <p className={styles.panelHint}>
        被试 ID 会绑定到本轮的诱发后与条件后量表记录，用于配对计算改善率。
      </p>

      <div className={styles.fieldGrid}>
        <label className={styles.fieldLabel}>
          <span className={styles.fieldLabelText}>被试 ID</span>
          <input
            className={styles.textInput}
            value={state.subjectId}
            onChange={(event) => flow.updateDraft({ subjectId: event.currentTarget.value })}
            placeholder="例如 subj-001"
            autoComplete="off"
          />
        </label>
        <label className={styles.fieldLabel}>
          <span className={styles.fieldLabelText}>条件时长（分钟）</span>
          <select
            className={styles.selectInput}
            value={state.durationMinutes}
            onChange={(event) => flow.updateDraft({ durationMinutes: Number(event.currentTarget.value) })}
          >
            {DURATION_MINUTE_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>{minutes}</option>
            ))}
          </select>
        </label>
      </div>

      <PillGroup
        label="目标情绪:"
        options={[...EFFECT_EMOTION_OPTIONS]}
        selectedValue={state.emotion}
        onSelect={(value) => flow.updateDraft({ emotion: value })}
      />
      <PillGroup
        label="调控手段（仅调控条件使用）:"
        options={EFFECT_METHOD_OPTIONS.map(({ value, label }) => ({ value, label }))}
        selectedValue={state.method}
        onSelect={(value) => flow.updateDraft({ method: value })}
      />
      <PillGroup
        label="实验条件:"
        options={EFFECT_CONDITION_OPTIONS.map(({ value, label }) => ({ value, label }))}
        selectedValue={state.condition}
        onSelect={(value) => flow.updateDraft({ condition: value })}
      />
      <p className={styles.panelHint} role="note">
        实验条件说明：基线条件（自然恢复）＝情绪诱发后不施加调控手段，静息自然恢复；
        调控条件＝情绪诱发后施加所选调控手段（音乐/视频）。同被试同情绪完成两种条件各一次后，结果步会给出跨条件对比。
      </p>

      {flow.actionError ? <div className={styles.errorBanner} role="alert">{flow.actionError}</div> : null}

      <div className={styles.actionsRow}>
        <Button
          variant="contained"
          disabled={state.subjectId.trim().length === 0}
          onClick={flow.startBaselineMeasurement}
        >
          下一步：情绪诱发
        </Button>
      </div>
    </section>
  );

  const renderInductionStep = () => {
    const status = flow.inductionStatus;

    return (
      <section className={styles.panel} aria-label="情绪诱发">
        <h2 className={styles.panelTitle}>情绪诱发</h2>
        <p className={styles.panelHint}>
          播放目标情绪的诱发素材（来自 EEG 采集页校验过的 video_paradigm 素材库）；
          开始诱发时在设备可用的情况下自动关联 EEG 记录，素材播放完毕后进入诱发后量表。
        </p>
        {configSummary}

        {flow.actionError ? <div className={styles.errorBanner} role="alert">{flow.actionError}</div> : null}

        {flow.isInductionPoolLoading ? (
          <p className={styles.panelHint}>正在加载诱发素材库…</p>
        ) : status.kind === 'blocked' ? (
          <Alert severity="warning">{status.copy}</Alert>
        ) : isInductionPlaying && status.kind === 'ready' ? (
          <>
            <video
              key={status.entry.videoId}
              className={styles.inductionVideo}
              src={toPlayableVideoUrl(status.entry.absolutePath, convertFileSrc)}
              controls
              autoPlay
              playsInline
              ref={(node) => {
                if (node) {
                  node.volume = 1;
                }
              }}
              onEnded={() => flow.completeInduction()}
            />
            <p className={styles.panelHint}>
              正在播放诱发素材「{status.entry.fileName}」，播放结束后自动进入诱发后量表。
            </p>
          </>
        ) : status.kind === 'ready' ? (
          <>
            <div className={styles.actionsRow}>
              <Button variant="contained" onClick={handleBeginInduction}>
                播放诱发素材（{status.entry.fileName}）
              </Button>
            </div>
            <p className={styles.panelHint}>
              点击开始后播放素材并计时，同时在设备可用时自动关联本次 EEG 记录。
            </p>
          </>
        ) : null}

        {renderEegAssociationChip()}
      </section>
    );
  };

  const renderScaleStep = (phase: 'baseline' | 'post') => {
    const isBaseline = phase === 'baseline';

    return (
      <section
        className={styles.panel}
        aria-label={isBaseline ? '诱发后量表' : '条件后量表'}
      >
        <h2 className={styles.panelTitle}>{isBaseline ? '诱发后量表' : '条件后复测'}</h2>
        <p className={styles.panelHint}>
          {isBaseline
            ? '情绪诱发已完成，请先完成一次心理量表，作为本次条件执行前的评价基线（phase 记为 baseline）。'
            : '条件执行已结束，请用同一份量表再测一次，用于计算各维度改善率。'}
        </p>
        {configSummary}

        {!isBaseline && skippedCopy ? <Alert severity="warning">{skippedCopy}</Alert> : null}

        {flow.actionError ? <div className={styles.errorBanner} role="alert">{flow.actionError}</div> : null}

        <div className={styles.actionsRow}>
          <Button
            variant="contained"
            disabled={flow.isSavingScale || !flow.scaleForMethod}
            onClick={() => setIsScaleDialogOpen(true)}
          >
            打开{isBaseline ? '诱发后' : '复测'}量表
          </Button>
        </div>

        {isScaleDialogOpen && flow.scaleForMethod ? (
          <MentalScaleDialog
            key={`scale-${phase}-${state.method}`}
            scale={flow.scaleForMethod}
            onComplete={(answers) => {
              setIsScaleDialogOpen(false);
              void flow.completeScaleMeasurement(phase, answers);
            }}
            onClose={() => setIsScaleDialogOpen(false)}
          />
        ) : null}
      </section>
    );
  };

  /**
   * Step 3, condition branch (R6): the regulation condition jumps to the
   * method's page under the wizard's wall-clock window; the natural-recovery
   * (基线) condition runs its rest countdown inside this page only - no
   * navigation, no regulation-page session context.
   */
  const renderConditionStep = () => (
    <section className={styles.panel} aria-label="条件执行">
      <h2 className={styles.panelTitle}>
        {isNaturalRecovery ? '条件执行：自然恢复（基线条件）' : '执行调控'}
      </h2>
      <p className={styles.panelHint}>
        {isNaturalRecovery
          ? '诱发后不施加任何调控手段：请让被试保持静息放松（减少眨眼与头动），按设定时长自然恢复，倒计时结束后进入复测。本步骤全程停留在本页。'
          : `前往${methodLabel}页面进行调控，本页按设定的时长计时；结束后回到本页继续复测。`}
      </p>

      <div className={styles.configSummary}>
        <span className={styles.configChip}>被试 {state.subjectId.trim() || '未填写'}</span>
        <span className={styles.configChip}>目标情绪 {emotionLabel}</span>
        <span className={styles.configChip}>{methodLabel}</span>
        <span className={styles.configChip}>{labelForCondition(state.condition)}</span>
        <span className={styles.configChip}>时长 {state.durationMinutes} 分钟</span>
        {state.eegSessionId ? (
          <span className={styles.configChip}>EEG 会话 {`${state.eegSessionId.slice(0, 8)}…`}</span>
        ) : null}
      </div>

      {state.regulationStartedAtMs === null ? (
        <Box className={styles.countdownWrap}>
          <p className={styles.panelHint}>
            点击开始后计时，并在设备可用时自动关联本次 EEG 记录。
          </p>
          <Button variant="contained" onClick={flow.beginRegulation}>
            {isNaturalRecovery ? '开始静息' : '开始调控'}
          </Button>
        </Box>
      ) : (
        <>
          <div className={styles.countdownWrap}>
            <span
              className={`${styles.countdownValue} ${flow.remainingSeconds === 0 ? styles.countdownDone : ''}`}
              aria-label={`剩余时间 ${formatCountdown(flow.remainingSeconds ?? 0)}`}
            >
              {formatCountdown(flow.remainingSeconds ?? 0)}
            </span>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-label={`${windowNoun}计时进度`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={regulationProgressPercent}
            >
              <div className={styles.progressBar} style={{ width: `${regulationProgressPercent}%` }} />
            </div>
            <p className={styles.panelHint}>
              {flow.remainingSeconds === 0
                ? `${windowNoun}时长已达成，可结束${windowNoun}进入复测。`
                : `未达最短时长：还剩 ${formatCountdown(flow.remainingSeconds ?? 0)}。计时结束后才能进入复测；确有特殊情况可跳过剩余时长（二次确认后记录标记）。`}
            </p>
          </div>

          {skippedCopy ? <Alert severity="warning">{skippedCopy}</Alert> : null}

          {renderEegAssociationChip()}

          <div className={styles.actionsRow}>
            {isNaturalRecovery ? null : (
              <Button variant="outlined" onClick={flow.openRegulationPage}>
                前往{methodLabel}
              </Button>
            )}
            {finishMode.mode === 'requires-skip' ? (
              <Button variant="outlined" color="warning" onClick={handleSkipRemaining}>
                跳过剩余时长…
              </Button>
            ) : null}
            <Button
              variant="contained"
              disabled={finishMode.mode !== 'finish'}
              onClick={handleFinishRegulation}
            >
              {isNaturalRecovery ? '结束静息，进行复测' : '结束调控，进行复测'}
            </Button>
          </div>
        </>
      )}
    </section>
  );

  /** R6, 大纲 6.2: regulation vs natural-recovery runs of this subject+emotion. */
  const renderConditionComparison = () => (
    <section className={styles.panel} aria-label="跨条件对比">
      <h2 className={styles.panelTitle}>跨条件对比（基线条件 vs 调控条件）</h2>
      <p className={styles.panelHint}>
        同被试同情绪分别完成 基线条件（自然恢复） 与 调控条件 各一次完整评价后，
        此处自动对比两条件的条件后得分。
      </p>

      {flow.isLoadingConditionComparison ? (
        <p className={styles.panelHint}>正在计算跨条件对比…</p>
      ) : null}

      {flow.conditionComparisonError ? (
        <>
          <Alert severity="info">
            {flow.conditionComparisonError}
            <br />
            需完成基线条件（自然恢复）与调控条件各一次完整评价，本卡才会展示跨条件对比。
          </Alert>
          <div className={styles.actionsRow}>
            <Button
              variant="outlined"
              onClick={() => void flow.loadConditionComparison()}
            >
              重试计算
            </Button>
          </div>
        </>
      ) : null}

      {flow.conditionComparison && comparisonVerdictCopy && !flow.isLoadingConditionComparison ? (
        <>
          <Alert severity={comparisonVerdictCopy.severity}>
            <strong>{comparisonVerdictCopy.title}</strong> -- {comparisonVerdictCopy.detail}
          </Alert>

          <div className={styles.statsRow}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>跨条件平均改善率</span>
              <span className={styles.statValue}>
                {flow.conditionComparison.meanImprovementRate === null
                  ? '-'
                  : formatImprovementRate(flow.conditionComparison.meanImprovementRate)}
              </span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>达标阈值</span>
              <span className={styles.statValue}>10%</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>实际纳入对比的维度数</span>
              <span className={styles.statValue}>{flow.conditionComparison.dimensions.length}</span>
            </div>
          </div>

          <p className={styles.panelHint} role="note">{CONDITION_COMPARISON_FORMULA_NOTE}</p>

          {comparisonMeasuredBasisNote ? (
            <p className={styles.panelHint} role="note">{comparisonMeasuredBasisNote}</p>
          ) : null}

          {comparisonChartOption ? (
            <>
              <EffectResultChart
                option={comparisonChartOption}
                ariaLabel="基线条件与调控条件条件后得分对比图"
              />
              <table className={styles.dimensionTable}>
                <thead>
                  <tr>
                    <th>维度</th>
                    <th>基线条件 post</th>
                    <th>调控条件 post</th>
                    <th>改善率</th>
                  </tr>
                </thead>
                <tbody>
                  {flow.conditionComparison.dimensions.map((dimension) => (
                    <tr key={dimension.dimension}>
                      <td>{labelForDimension(dimension.dimension)}</td>
                      <td>{Math.round(dimension.naturalRecoveryPost)}</td>
                      <td>{Math.round(dimension.regulationPost)}</td>
                      <td className={dimension.improvementRate >= 0
                        ? `${styles.rateCell} ${styles.isPositive}`
                        : `${styles.rateCell} ${styles.isNegative}`}
                      >
                        {formatImprovementRate(dimension.improvementRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );

  const renderResultStep = () => (
    <section className={styles.panel} aria-label="结果评价">
      <h2 className={styles.panelTitle}>结果评价</h2>

      {flow.isLoadingSummary ? <p className={styles.panelHint}>正在计算改善率…</p> : null}

      {flow.summaryError ? (
        <>
          <Alert severity="warning">{flow.summaryError}</Alert>
          <div className={styles.actionsRow}>
            <Button variant="outlined" onClick={() => void flow.loadSummary()}>
              重试计算
            </Button>
          </div>
        </>
      ) : null}

      {flow.summary && verdictCopy && !flow.isLoadingSummary ? (
        <>
          <Alert severity={verdictCopy.severity}>
            <strong>{verdictCopy.title}</strong> -- {verdictCopy.detail}
          </Alert>

          {skippedCopy ? <Alert severity="warning">{skippedCopy}</Alert> : null}

          <div className={styles.statsRow}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>平均改善率</span>
              <span className={styles.statValue}>
                {flow.summary.meanImprovementRate === null
                  ? '-'
                  : formatImprovementRate(flow.summary.meanImprovementRate)}
              </span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>达标阈值</span>
              <span className={styles.statValue}>10%</span>
            </div>
            {/* R4/F1: only dimensions marked as measured on both sides enter
                the mean, so this count is the honest comparison basis. */}
            <div className={styles.statCard}>
              <span className={styles.statLabel}>实际纳入对比的维度数</span>
              <span className={styles.statValue}>{flow.summary.dimensions.length}</span>
            </div>
          </div>

          {measuredBasisNote ? (
            <p className={styles.panelHint} role="note">{measuredBasisNote}</p>
          ) : null}

          {state.eegSessionId ? (
            <div className={styles.configSummary}>
              <span className={styles.configChip} title={state.eegSessionId}>
                关联 EEG 会话 {`${state.eegSessionId.slice(0, 8)}…`}
              </span>
            </div>
          ) : null}

          {chartOption ? (
            <>
              <EffectResultChart option={chartOption} />
              <table className={styles.dimensionTable}>
                <thead>
                  <tr>
                    <th>维度</th>
                    <th>基线</th>
                    <th>调控后</th>
                    <th>改善率</th>
                  </tr>
                </thead>
                <tbody>
                  {flow.summary.dimensions.map((dimension) => (
                    <tr key={dimension.dimension}>
                      <td>{labelForDimension(dimension.dimension)}</td>
                      <td>{Math.round(dimension.baseline)}</td>
                      <td>{Math.round(dimension.post)}</td>
                      <td className={dimension.improvementRate >= 0
                        ? `${styles.rateCell} ${styles.isPositive}`
                        : `${styles.rateCell} ${styles.isNegative}`}
                      >
                        {formatImprovementRate(dimension.improvementRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          <div className={styles.actionsRow}>
            <Button
              variant="outlined"
              disabled={isExporting}
              onClick={() => void runSingleExport('json')}
            >
              导出单次报告（JSON）
            </Button>
            <Button
              variant="outlined"
              disabled={isExporting}
              onClick={() => void runSingleExport('csv')}
            >
              导出单次报告（CSV）
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );

  const regulationProgressPercent = Math.min(100, Math.max(0,
    100 - ((flow.remainingSeconds ?? 0) * 1000 / regulationDurationMs(state)) * 100,
  ));

  const stepContent: ReactNode[] = [
    renderSetupStep(),
    renderInductionStep(),
    renderScaleStep('baseline'),
    renderConditionStep(),
    renderScaleStep('post'),
    renderResultStep(),
  ];

  return (
    <Box className={styles.workspace} aria-label="情绪调控效果评价">
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <div>
            <div className={styles.eyebrow}>效果评价闭环</div>
            <h1 className={styles.title}>情绪调控效果评价</h1>
            <p className={styles.description}>
              按 情绪诱发 → 诱发后量表 → 条件执行 → 条件后量表 的流程采集同一被试的两次量表，
              自动计算各维度改善率并与 10% 阈值比较；基线条件（自然恢复）与调控条件各完成一次后可跨条件对比。
            </p>
          </div>
          <div className={styles.headerActions}>
            <Button
              variant="outlined"
              disabled={isExporting}
              onClick={() => void runBatchExport()}
            >
              批量汇总导出（CSV）
            </Button>
          </div>
        </div>
      </header>

      {exportNotice ? (
        <Alert severity={exportNotice.severity} onClose={() => setExportNotice(null)}>
          {exportNotice.text}
        </Alert>
      ) : null}

      <Tabs
        value={activeTab}
        onChange={(_event, next: PageTab) => setActiveTab(next)}
        aria-label="效果评价视图切换"
        className={styles.tabBar}
      >
        <Tab value="wizard" label="评价向导" />
        <Tab value="history" label="历史记录" />
      </Tabs>

      {activeTab === 'wizard' ? (
        <>
          <Stepper activeStep={state.step} alternativeLabel className={styles.stepper}>
            {EFFECT_FLOW_STEPS.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {state.step === 5 ? (
            <>{stepContent[5]}{renderConditionComparison()}</>
          ) : (
            stepContent[state.step]
          )}

          {state.step > 0 ? (
            <div className={styles.actionsRow}>
              <button type="button" className={styles.secondaryAction} onClick={flow.resetFlow}>
                重置流程
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <EffectHistoryPanel />
      )}

      {confirmDialogElement}
    </Box>
  );
}
