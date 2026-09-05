import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import Alert from '@mui/material/Alert';
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
 * The four interactive stage bodies of the effect-evaluation loop (setup,
 * induction, scale, condition). Each mounts exclusively inside the main
 * stage card while its node is current, and each offers exactly ONE primary
 * CTA (`.primaryCta`, the big button); every other action (skip, standalone
 * page, retry, reset) is a quiet ghost control in a secondary row so the
 * next step is never ambiguous.
 *
 * Performance contract: nothing in the stage re-renders on the wall clock.
 * The condition window's 500ms poll lives entirely inside the self-contained
 * `ConditionCountdown` child (`EffectConditionCountdown.tsx`), which ticks its
 * own digits and reports expiry upward exactly once via `onWindowElapsed`;
 * the panels re-render only on real flow-state changes and on that one-shot
 * expiry flip.
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
    <section className={styles.stageBody} aria-label="选择被试与评价配置">
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

      <div className={styles.stagePrimaryRow}>
        <Button
          className={styles.primaryCta}
          variant="contained"
          disabled={state.subjectId.trim().length === 0}
          onClick={flow.startBaselineMeasurement}
        >
          确认配置，开始诱发
        </Button>
        {/* The disabled CTA never guesses itself: say what is missing. */}
        {state.subjectId.trim().length === 0 ? (
          <p className={styles.stageHint} role="note">填写被试 ID 后即可开始。</p>
        ) : null}
      </div>
    </section>
  );
}

export type InductionStepPanelProps = {
  flow: EffectEvaluationFlow;
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
  // The blocked branch sends the operator to where the paradigm library is
  // selected/validated; the run survives the detour in sessionStorage and
  // resumes at this step on return (no recording is live while blocked).
  const navigate = useNavigate();

  return (
    <section className={styles.stageBody} aria-label="情绪诱发">
      {state.eegAssociation === 'unavailable' ? eegUnavailableHint : null}

      {flow.actionError ? <div className={styles.errorBanner} role="alert">{flow.actionError}</div> : null}

      {flow.isInductionPoolLoading ? (
        <p className={`${styles.panelHint} ${styles.loadingHint}`}>正在加载诱发素材库…</p>
      ) : status.kind === 'blocked' ? (
        <>
          {/* Blocked, not broken: the alert says what is missing, the ghost
              button takes the operator straight there (the flow state stays
              in sessionStorage, so returning resumes at this step). */}
          <Alert severity="warning">{status.copy}</Alert>
          <div className={styles.stageSecondaryRow}>
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={() => navigate('/eeg-acquisition')}
            >
              前往 EEG 采集页处理素材库
            </button>
          </div>
        </>
      ) : inductionVideoFailed && status.kind === 'ready' ? (
        <>
          {/* R7: a mid-run file failure (moved/corrupted) must not strand
              the induction step - only onEnded advances, so onError needs
              its own branch with a retry and a way back to the setup step. */}
          <Alert severity="error">
            诱发素材加载失败（文件可能已被移动或损坏），播放已中断。可重试加载；
            若素材库文件已缺失，请先到 EEG 采集页补齐素材库，或重置流程返回设置步。
          </Alert>
          <div className={styles.stageSecondaryRow}>
            <button type="button" className={styles.secondaryAction} onClick={onRetryInductionVideo}>
              重试加载素材
            </button>
            <button type="button" className={styles.secondaryAction} onClick={onResetFlow}>
              重置并返回设置步
            </button>
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
          <div className={styles.stagePrimaryRow}>
            <Button className={styles.primaryCta} variant="contained" onClick={onBeginInduction}>
              开始播放
            </Button>
          </div>
          <p className={styles.panelHint}>
            将播放素材「{status.entry.fileName}」；开始后在设备可用的情况下自动关联本次 EEG 记录。
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
  skippedCopy,
  isDialogOpen,
  onOpenDialog,
  onCloseDialog,
}: ScaleStepPanelProps) {
  const isBaseline = phase === 'baseline';
  const { state } = flow;

  return (
    <section className={styles.stageBody} aria-label={isBaseline ? '诱发后量表' : '条件后量表'}>
      {!isBaseline && skippedCopy ? <Alert severity="warning">{skippedCopy}</Alert> : null}

      {flow.actionError ? <div className={styles.errorBanner} role="alert">{flow.actionError}</div> : null}

      <div className={styles.stagePrimaryRow}>
        <Button
          className={styles.primaryCta}
          variant="contained"
          disabled={flow.isSavingScale}
          onClick={onOpenDialog}
        >
          {flow.isSavingScale ? '正在保存量表…' : '开始填写'}
        </Button>
      </div>

      <EegAssociationChip association={state.eegAssociation} sessionId={state.eegSessionId} />

      {isDialogOpen ? (
        <InstrumentScaleDialog
          key={`scale-${phase}`}
          definition={flow.scaleDefinitionFor(phase)}
          isSubmitting={flow.isSavingScale}
          submitError={flow.actionError}
          onComplete={(answers) => {
            // The dialog STAYS OPEN while the record saves: closing first used
            // to throw away 40+ filled answers whenever the save failed. The
            // flow advances on success, which unmounts this panel (and the
            // dialog) naturally; on failure the answers remain on screen with
            // the error in the dialog footer.
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
  skippedCopy: string | null;
  /** One-shot expiry fact of the window (drives the player's to-zero pause). */
  isWindowElapsed: boolean;
  /** Reported by the countdown leaf when the window first reads 0. */
  onWindowElapsed: () => void;
  onFinishRegulation: () => void;
  onSkipRemaining: () => void;
  eegUnavailableHint: ReactNode;
};

/**
 * Node 3 interaction area, condition branch (R6): before the window starts
 * the panel offers one big start CTA; while it runs the stage turns into
 * the countdown + embedded player with the finish exit as the single
 * primary button and skip/standalone-page as quiet secondaries. The
 * natural-recovery (基线) condition runs its rest countdown inside this page
 * only - no media, no navigation, no regulation-page session context.
 */
export function ConditionStepPanel({
  flow,
  finishMode,
  windowNoun,
  isNaturalRecovery,
  methodLabel,
  skippedCopy,
  isWindowElapsed,
  onWindowElapsed,
  onFinishRegulation,
  onSkipRemaining,
  eegUnavailableHint,
}: ConditionStepPanelProps) {
  const { state } = flow;
  const isStarted = state.regulationStartedAtMs !== null;

  return (
    <section className={styles.stageBody} aria-label="条件执行">
      {state.eegAssociation === 'unavailable' ? eegUnavailableHint : null}

      {flow.actionError ? <div className={styles.errorBanner} role="alert">{flow.actionError}</div> : null}

      {!isStarted ? (
        <>
          <div className={styles.stagePrimaryRow}>
            <Button className={styles.primaryCta} variant="contained" onClick={flow.beginRegulation}>
              {isNaturalRecovery ? '开始静息' : '开始调控'}
            </Button>
          </div>
          <p className={styles.panelHint}>
            点击开始后计时，并在设备可用时自动关联本次 EEG 记录。
          </p>
          <EegAssociationChip association={state.eegAssociation} sessionId={state.eegSessionId} />
        </>
      ) : (
        <>
          {/* The ticking digits live only in this self-contained child: it
              owns the 500ms wall-clock poll, re-renders just this subtree on
              a changed second, and reports expiry upward exactly once. */}
          <ConditionCountdown
            state={state}
            windowNoun={windowNoun}
            onElapsed={onWindowElapsed}
          />

          {/* Embedded regulation media: the stage hosts the player itself;
              it pauses when the window elapsed and unmounts (stopping
              playback) if the operator jumps to the standalone page. The
              remaining-seconds prop carries the one-shot expiry fact
              (0 once elapsed, null before/while running) — the page does
              not track per-tick seconds. The natural-recovery condition
              has no media to play. */}
          {!isNaturalRecovery ? (
            <EffectRegulationPlayer
              method={state.method}
              remainingSeconds={isWindowElapsed ? 0 : null}
            />
          ) : null}

          {skippedCopy ? <Alert severity="warning">{skippedCopy}</Alert> : null}

          <EegAssociationChip association={state.eegAssociation} sessionId={state.eegSessionId} />

          {/* Strong duration constraint: the primary exit unlocks only at
              zero; leaving early rides the double-confirmed skip below. */}
          <div className={styles.stagePrimaryRow}>
            <Button
              className={styles.primaryCta}
              variant="contained"
              disabled={finishMode.mode !== 'finish'}
              aria-describedby={finishMode.mode !== 'finish' ? 'regulation-countdown-hint' : undefined}
              onClick={onFinishRegulation}
            >
              {isNaturalRecovery ? '结束静息，进行复测' : '结束调控，进行复测'}
            </Button>
          </div>

          <div className={styles.stageSecondaryRow}>
            {isNaturalRecovery ? null : (
              <button type="button" className={styles.secondaryAction} onClick={flow.openRegulationPage}>
                在独立页打开{methodLabel}
              </button>
            )}
            {finishMode.mode === 'requires-skip' ? (
              <button type="button" className={styles.secondaryActionDanger} onClick={onSkipRemaining}>
                跳过剩余时长…
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
