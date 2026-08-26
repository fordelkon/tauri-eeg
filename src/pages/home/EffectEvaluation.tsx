import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import type { EChartsType } from 'echarts/core';
import MentalScaleDialog from '../../mentalScale/MentalScaleDialog';
import { useConfirmDialog } from '../../ui/useConfirmDialog';
import {
  buildEffectVerdictCopy,
  EFFECT_EMOTION_OPTIONS,
  EFFECT_FLOW_STEPS,
  EFFECT_METHOD_OPTIONS,
  formatCountdown,
  formatImprovementRate,
  labelForDimension,
  regulationDurationMs,
} from './effectEvaluationFlow';
import { buildEffectChartOption } from './effectResultChartOption';
import { useEffectEvaluationFlow } from './useEffectEvaluationFlow';
import styles from './EffectEvaluation.module.css';

const DURATION_MINUTE_OPTIONS = [1, 3, 5, 10, 15, 30] as const;

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

  const emotionLabel = EFFECT_EMOTION_OPTIONS.find(
    (option) => option.value === state.emotion,
  )?.label ?? state.emotion;
  const methodLabel = EFFECT_METHOD_OPTIONS.find(
    (option) => option.value === state.method,
  )?.label ?? state.method;

  const verdictCopy = useMemo(
    () => (flow.summary ? buildEffectVerdictCopy(flow.summary) : null),
    [flow.summary],
  );
  const chartOption = useMemo(
    () => (flow.summary && flow.summary.dimensions.length > 0
      ? buildEffectChartOption(flow.summary)
      : null),
    [flow.summary],
  );

  const handleFinishRegulation = () => {
    if (flow.remainingSeconds !== null && flow.remainingSeconds > 0) {
      void confirm({
        title: '提前结束调控？',
        description: `调控计时还剩 ${formatCountdown(flow.remainingSeconds)}，提前结束可能低估调控效果。确定进入复测吗?`,
        confirmText: '提前结束',
        destructive: true,
      }).then((confirmed) => {
        if (confirmed) {
          void flow.finishRegulation();
        }
      });
      return;
    }

    void flow.finishRegulation();
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
                : `剩余 ${formatCountdown(flow.remainingSeconds ?? 0)} · 计时在离开页面后仍继续。`}
            </p>
          </div>

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
            <Button
              variant="contained"
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
            <div className={styles.statCard}>
              <span className={styles.statLabel}>可对比维度</span>
              <span className={styles.statValue}>{flow.summary.dimensions.length}</span>
            </div>
          </div>

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
        <div className={styles.eyebrow}>效果评价闭环</div>
        <h1 className={styles.title}>情绪调控效果评价</h1>
        <p className={styles.description}>
          按 基线量表 → 执行调控 → 调控后量表 的流程采集同一被试的两次量表，
          自动计算各维度改善率并与 10% 阈值比较。
        </p>
      </header>

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

      {confirmDialogElement}
    </Box>
  );
}
