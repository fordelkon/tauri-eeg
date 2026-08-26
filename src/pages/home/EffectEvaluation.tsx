import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import MentalScaleDialog from '../../mentalScale/MentalScaleDialog';
import { exportEffectReport } from '../../mentalScale/scaleRecordsApi';
import { useConfirmDialog } from '../../ui/useConfirmDialog';
import { describeFriendlyError } from '../../ui/friendlyError';
import {
  buildEffectVerdictCopy,
  describeMeasuredBasis,
  describeRegulationSkipped,
  EFFECT_EMOTION_OPTIONS,
  EFFECT_FLOW_STEPS,
  EFFECT_METHOD_OPTIONS,
  formatCountdown,
  formatImprovementRate,
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
import { buildEffectChartOption } from './effectResultChartOption';
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
function EffectResultChart({ option }: { option: Record<string, unknown> }) {
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
      aria-label="基线与调控后量表得分对比图"
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
  // Steps 1/3 present the shared gate dialog on demand; closing it only
  // dismisses the dialog, it never touches the flow itself.
  const [isScaleDialogOpen, setIsScaleDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PageTab>('wizard');
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<ExportNotice | null>(null);

  const emotionLabel = EFFECT_EMOTION_OPTIONS.find(
    (option) => option.value === state.emotion,
  )?.label ?? state.emotion;
  const methodLabel = EFFECT_METHOD_OPTIONS.find(
    (option) => option.value === state.method,
  )?.label ?? state.method;

  // Strong duration constraint (R3): the countdown is a hard floor — the
  // normal finish unlocks only at zero, earlier exits go through the
  // double-confirmed skip which records the marker with the run.
  const finishMode = regulationFinishModeFromRemaining(flow.remainingSeconds);
  const skippedCopy = describeRegulationSkipped(state);

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

  /** Normal exit — only offered once the countdown reached zero. */
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
      title: '跳过剩余调控时长？',
      description: `计时还剩 ${formatCountdown(finishMode.remainingSeconds)}，未达设定的最短时长。跳过后本次评价会记录“已跳过”标记，改善率可能低估实际效果。确定跳过并进入复测吗？`,
      confirmText: '确认跳过',
      destructive: true,
    }).then((confirmed) => {
      if (confirmed) {
        void flow.skipRemainingRegulation();
      }
    });
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
    </div>
  );

  const renderSetupStep = () => (
    <section className={styles.panel} aria-label="选择被试与调控配置">
      <h2 className={styles.panelTitle}>选择被试</h2>
      <p className={styles.panelHint}>
        被试 ID 会绑定到本轮的基线与调控后量表记录，用于配对计算改善率。
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
          <span className={styles.fieldLabelText}>调控时长（分钟）</span>
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
        label="调控手段:"
        options={EFFECT_METHOD_OPTIONS.map(({ value, label }) => ({ value, label }))}
        selectedValue={state.method}
        onSelect={(value) => flow.updateDraft({ method: value })}
      />

      {flow.actionError ? <div className={styles.errorBanner} role="alert">{flow.actionError}</div> : null}

      <div className={styles.actionsRow}>
        <Button
          variant="contained"
          disabled={state.subjectId.trim().length === 0}
          onClick={flow.startBaselineMeasurement}
        >
          下一步：基线测量
        </Button>
      </div>
    </section>
  );

  const renderScaleStep = (phase: 'baseline' | 'post') => {
    const isBaseline = phase === 'baseline';

    return (
      <section className={styles.panel} aria-label={isBaseline ? '基线测量' : '调控后测量'}>
        <h2 className={styles.panelTitle}>{isBaseline ? '基线量表' : '调控后复测'}</h2>
        <p className={styles.panelHint}>
          {isBaseline
            ? '开始调控前，请先完成一次心理量表，作为本次调控的评价基线。'
            : '调控已结束，请用同一份量表再测一次，用于计算各维度改善率。'}
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
            打开{isBaseline ? '基线' : '复测'}量表
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

  const renderRegulationStep = () => (
    <section className={styles.panel} aria-label="执行调控">
      <h2 className={styles.panelTitle}>执行调控</h2>
      <p className={styles.panelHint}>
        前往{methodLabel}页面进行调控，本页按设定的时长计时；结束后回到本页继续复测。
      </p>

      <div className={styles.configSummary}>
        <span className={styles.configChip}>被试 {state.subjectId.trim() || '未填写'}</span>
        <span className={styles.configChip}>目标情绪 {emotionLabel}</span>
        <span className={styles.configChip}>{methodLabel}</span>
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
            开始调控
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
              aria-label="调控计时进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={regulationProgressPercent}
            >
              <div className={styles.progressBar} style={{ width: `${regulationProgressPercent}%` }} />
            </div>
            <p className={styles.panelHint}>
              {flow.remainingSeconds === 0
                ? '调控时长已达成，可结束调控进入复测。'
                : `未达最短时长：还剩 ${formatCountdown(flow.remainingSeconds ?? 0)}。计时结束后才能进入复测；确有特殊情况可跳过剩余时长（二次确认后记录标记）。`}
            </p>
          </div>

          {skippedCopy ? <Alert severity="warning">{skippedCopy}</Alert> : null}

          {state.eegAssociation !== 'not-started' ? (
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
          ) : null}

          <div className={styles.actionsRow}>
            <Button variant="outlined" onClick={flow.openRegulationPage}>
              前往{methodLabel}
            </Button>
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
              结束调控，进行复测
            </Button>
          </div>
        </>
      )}
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
            <strong>{verdictCopy.title}</strong> —— {verdictCopy.detail}
          </Alert>

          {skippedCopy ? <Alert severity="warning">{skippedCopy}</Alert> : null}

          <div className={styles.statsRow}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>平均改善率</span>
              <span className={styles.statValue}>
                {flow.summary.meanImprovementRate === null
                  ? '—'
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
    renderScaleStep('baseline'),
    renderRegulationStep(),
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
              按 基线量表 → 执行调控 → 调控后量表 的流程采集同一被试的两次量表，
              自动计算各维度改善率并与 10% 阈值比较。
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

          {stepContent[state.step]}

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
