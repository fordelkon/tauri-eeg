import { type ReactNode } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import InstrumentScaleDialog from '../../mentalScale/InstrumentScaleDialog';
import { toPlayableVideoUrl } from '../../video/videoRegulationCatalog';
import EffectRegulationPlayer from './EffectRegulationPlayer';
import { ConditionCountdown } from './EffectConditionCountdown';
import {
  EFFECT_CONDITION_OPTIONS,
  EFFECT_EMOTION_OPTIONS,
  EFFECT_METHOD_OPTIONS,
  type EffectEegAssociation,
  type RegulationFinishMode,
} from './effectEvaluationFlow';
import { describeEegAssociation } from './effectPipeline';
import { PillGroup } from './EffectResultCards';
import type { EffectEvaluationFlow } from './useEffectEvaluationFlow';
import styles from './EffectEvaluation.module.css';

/**
 * The four interactive step panels of the effect pipeline (setup, induction,
 * scale, condition). Their content is moved verbatim from the former
 * `render*Step` functions of the wizard page; only the wiring changed from
 * closures to props. Each panel mounts exclusively inside its pipeline
 * node's card body (the current node), so none of them need memoization —
 * except the countdown below, whose digits are the only wall-clock-ticking
 * output on the board.
 */

const DURATION_MINUTE_OPTIONS = [1, 3, 5, 10, 15, 30] as const;

/** EEG association chip shared by the induction, scale and condition panels. */
export function EegAssociationChip({
  association,
  sessionId,
}: {
  association: EffectEegAssociation;
  sessionId: string | null;
}) {
  if (association === 'not-started') {
    return null;
  }

  return (
    <div className={styles.pillRow}>
      <span
        role="status"
        className={`${styles.eegChip} ${
          association === 'saved'
            ? styles.eegSaved
            : association === 'recording'
              ? styles.eegRecording
              : styles.eegUnavailable
        }`}
      >
        {association === 'saved'
          ? `✓ ${describeEegAssociation(association)}${sessionId ? `（会话 ${`${sessionId.slice(0, 8)}…`}）` : ''}`
          : association === 'recording'
            ? `● ${describeEegAssociation(association)}`
            : `! ${describeEegAssociation(association)}`}
      </span>
    </div>
  );
}

/** Trial-run hint shown atop the induction and condition interaction areas
 *  when the device was unavailable; the loop never blocks on it (the hook
 *  degrades the association to `unavailable` and keeps advancing). */
export function EegUnavailableHint() {
  return (
    <p className={styles.noteCallout} role="note">
      试运行：未连接 EEG 设备，本轮不记录 EEG 数据；量表与条件流程照常推进。
    </p>
  );
}

export type SetupStepPanelProps = {
  flow: EffectEvaluationFlow;
};

/** Node 0 interaction area: subject binding + run configuration draft. */
export function SetupStepPanel({ flow }: SetupStepPanelProps) {
  const { state } = flow;

  return (
    <section className={styles.panel} aria-label="选择被试与评价配置">
      <div className={styles.stepHeader}>
        <h2 className={styles.panelTitle}>选择被试</h2>
        <p className={styles.panelHint}>
          被试 ID 会绑定到本轮的诱发后与条件后量表记录，用于配对计算改善率。
        </p>
      </div>

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
      <div className={styles.setupSection}>
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
        <p className={styles.noteCallout} role="note">
          实验条件说明：基线条件（自然恢复）＝情绪诱发后不施加调控手段，静息自然恢复；调控条件＝情绪诱发后施加所选调控手段（音乐/视频）。同被试同情绪完成两种条件各一次后，结果步会给出跨条件对比。
        </p>
      </div>

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
}

export type InductionStepPanelProps = {
  flow: EffectEvaluationFlow;
  configSummary: ReactNode;
  eegUnavailableHint: ReactNode;
  isInductionPlaying: boolean;
  inductionVideoFailed: boolean;
  inductionRetryCount: number;
  onBeginInduction: () => void;
  onResetFlow: () => void | Promise<void>;
  onRetryInductionVideo: () => void;
  onVideoError: () => void;
};

/** Node 1 interaction area: induction playback with the pool gating. */
export function InductionStepPanel({
  flow,
  configSummary,
  eegUnavailableHint,
  isInductionPlaying,
  inductionVideoFailed,
  inductionRetryCount,
  onBeginInduction,
  onResetFlow,
  onRetryInductionVideo,
  onVideoError,
}: InductionStepPanelProps) {
  const status = flow.inductionStatus;
  const { state } = flow;

  return (
    <section className={styles.panel} aria-label="情绪诱发">
      <div className={styles.stepHeader}>
        <h2 className={styles.panelTitle}>情绪诱发</h2>
        <p className={styles.panelHint}>
          播放目标情绪的诱发素材（来自 EEG 采集页校验过的 video_paradigm 素材库）；
          开始诱发时在设备可用的情况下自动关联 EEG 记录，素材播放完毕后进入诱发后量表。
        </p>
      </div>
      {configSummary}

      {state.eegAssociation === 'unavailable' ? eegUnavailableHint : null}

      {flow.actionError ? <div className={styles.errorBanner} role="alert">{flow.actionError}</div> : null}

      {flow.isInductionPoolLoading ? (
        <p className={`${styles.panelHint} ${styles.loadingHint}`}>正在加载诱发素材库…</p>
      ) : status.kind === 'blocked' ? (
        <Alert severity="warning">{status.copy}</Alert>
      ) : inductionVideoFailed && status.kind === 'ready' ? (
        <>
          {/* R7: a mid-run file failure (moved/corrupted) must not strand
              the induction step - only onEnded advances, so onError needs
              its own branch with a retry and a way back to the setup step. */}
          <Alert severity="error">
            诱发素材加载失败（文件可能已被移动或损坏），播放已中断。可重试加载；
            若素材库文件已缺失，请先到 EEG 采集页补齐素材库，或重置流程返回设置步。
          </Alert>
          <div className={styles.actionsRow}>
            <Button variant="outlined" onClick={onRetryInductionVideo}>
              重试加载素材
            </Button>
            <Button variant="outlined" color="warning" onClick={onResetFlow}>
              重置并返回设置步
            </Button>
          </div>
        </>
      ) : isInductionPlaying && status.kind === 'ready' ? (
        <>
          <video
            key={`${status.entry.videoId}-${inductionRetryCount}`}
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
            onError={onVideoError}
          />
          <p className={styles.panelHint}>
            正在播放诱发素材「{status.entry.fileName}」，播放结束后自动进入诱发后量表。
          </p>
        </>
      ) : status.kind === 'ready' ? (
        <>
          <div className={styles.actionsRow}>
            <Button variant="contained" onClick={onBeginInduction}>
              播放诱发素材（{status.entry.fileName}）
            </Button>
          </div>
          <p className={styles.panelHint}>
            点击开始后播放素材并计时，同时在设备可用时自动关联本次 EEG 记录。
          </p>
        </>
      ) : null}

      <EegAssociationChip association={state.eegAssociation} sessionId={state.eegSessionId} />
    </section>
  );
}

export type ScaleStepPanelProps = {
  flow: EffectEvaluationFlow;
  phase: 'baseline' | 'post';
  configSummary: ReactNode;
  skippedCopy: string | null;
  isDialogOpen: boolean;
  onOpenDialog: () => void;
  onCloseDialog: () => void;
};

/** Node 2 / node 4 interaction area: the battery dialog opens on demand;
 *  closing it only dismisses the dialog, it never touches the flow itself. */
export function ScaleStepPanel({
  flow,
  phase,
  configSummary,
  skippedCopy,
  isDialogOpen,
  onOpenDialog,
  onCloseDialog,
}: ScaleStepPanelProps) {
  const isBaseline = phase === 'baseline';
  const { state } = flow;

  return (
    <section
      className={`${styles.panel} ${styles.panelImmersive}`}
      aria-label={isBaseline ? '诱发后量表' : '条件后量表'}
    >
      <div className={styles.stepHeader}>
        <h2 className={styles.panelTitle}>{isBaseline ? '诱发后量表' : '条件后复测'}</h2>
        <p className={styles.panelHint}>
          {isBaseline
            ? '情绪诱发已完成，请先完成 SAM 操纵检验与 STAI-S + PANAS 情绪状态量表，作为本次条件执行前的评价基线（phase 记为 baseline）。'
            : state.method === 'music'
              ? '条件执行已结束，请用同一份 STAI-S + PANAS 量表再测一次，并完成 GEMS-9 音乐情绪感受量表（仅音乐条件），用于计算各维度改善率。'
              : '条件执行已结束，请用同一份 STAI-S + PANAS 量表再测一次，用于计算各维度改善率。'}
        </p>
      </div>
      {configSummary}

      {!isBaseline && skippedCopy ? <Alert severity="warning">{skippedCopy}</Alert> : null}

      {flow.actionError ? <div className={styles.errorBanner} role="alert">{flow.actionError}</div> : null}

      <div className={styles.actionsRow}>
        <Button
          variant="contained"
          disabled={flow.isSavingScale}
          onClick={onOpenDialog}
        >
          {flow.isSavingScale ? '正在保存量表…' : `打开${isBaseline ? '诱发后' : '复测'}量表`}
        </Button>
      </div>

      <EegAssociationChip association={state.eegAssociation} sessionId={state.eegSessionId} />

      {isDialogOpen ? (
        <InstrumentScaleDialog
          key={`scale-${phase}`}
          definition={flow.scaleDefinitionFor(phase)}
          onComplete={(answers) => {
            onCloseDialog();
            void flow.completeScaleMeasurement(phase, answers);
          }}
          onClose={onCloseDialog}
        />
      ) : null}
    </section>
  );
}

export type ConditionStepPanelProps = {
  flow: EffectEvaluationFlow;
  finishMode: RegulationFinishMode;
  windowNoun: string;
  isNaturalRecovery: boolean;
  methodLabel: string;
  configSummary: ReactNode;
  skippedCopy: string | null;
  onFinishRegulation: () => void;
  onSkipRemaining: () => void;
  eegUnavailableHint: ReactNode;
};

/**
 * Node 3 interaction area, condition branch (R6): the regulation condition
 * plays its media inside this card via the embedded player (the main path);
 * the standalone method page remains available through the existing button
 * (same sessionStorage bridge, zero protocol change). The natural-recovery
 * (基线) condition runs its rest countdown inside this page only - no media,
 * no navigation, no regulation-page session context.
 */
export function ConditionStepPanel({
  flow,
  finishMode,
  windowNoun,
  isNaturalRecovery,
  methodLabel,
  configSummary,
  skippedCopy,
  onFinishRegulation,
  onSkipRemaining,
  eegUnavailableHint,
}: ConditionStepPanelProps) {
  const { state } = flow;
  const isStarted = state.regulationStartedAtMs !== null;

  return (
    <section className={`${styles.panel} ${styles.panelImmersive}`} aria-label="条件执行">
      <div className={styles.stepHeader}>
        <h2 className={styles.panelTitle}>
          {isNaturalRecovery ? '条件执行：自然恢复（基线条件）' : '执行调控'}
        </h2>
        <p className={styles.panelHint}>
          {isNaturalRecovery
            ? '诱发后不施加任何调控手段：请让被试保持静息放松（减少眨眼与头动），按设定时长自然恢复，倒计时结束后进入复测。本步骤全程停留在本页。'
            : `点击开始后在本页内嵌播放${methodLabel}调控素材并按设定时长计时；也可前往独立页面打开（计时与 EEG 关联不中断），结束后回到本页继续复测。`}
        </p>
      </div>

      {configSummary}

      {state.eegAssociation === 'unavailable' ? eegUnavailableHint : null}

      {flow.actionError ? <div className={styles.errorBanner} role="alert">{flow.actionError}</div> : null}

      {!isStarted ? (
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
          {/* The ticking digits live only in this memo child: a wall-clock
              tick re-renders just this subtree inside the condition card. */}
          <ConditionCountdown
            remainingSeconds={flow.remainingSeconds ?? 0}
            totalSeconds={state.durationMinutes * 60}
            windowNoun={windowNoun}
          />

          {/* Embedded regulation media: the condition card hosts the player
              itself; it pauses when the countdown reaches 0 and unmounts
              (stopping playback) if the operator jumps to the standalone
              page. The natural-recovery condition has no media to play. */}
          {!isNaturalRecovery ? (
            <EffectRegulationPlayer
              method={state.method}
              remainingSeconds={flow.remainingSeconds}
            />
          ) : null}

          {skippedCopy ? <Alert severity="warning">{skippedCopy}</Alert> : null}

          <EegAssociationChip association={state.eegAssociation} sessionId={state.eegSessionId} />

          <div className={styles.actionsRow}>
            {isNaturalRecovery ? null : (
              <Button variant="outlined" onClick={flow.openRegulationPage}>
                前往{methodLabel}
              </Button>
            )}
            {finishMode.mode === 'requires-skip' ? (
              <Button variant="outlined" color="error" onClick={onSkipRemaining}>
                跳过剩余时长…
              </Button>
            ) : null}
            <Button
              variant="contained"
              disabled={finishMode.mode !== 'finish'}
              aria-describedby={finishMode.mode !== 'finish' ? 'regulation-countdown-hint' : undefined}
              onClick={onFinishRegulation}
            >
              {isNaturalRecovery ? '结束静息，进行复测' : '结束调控，进行复测'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

