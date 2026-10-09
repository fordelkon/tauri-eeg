import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import InstrumentScaleDialog from '../../mentalScale/InstrumentScaleDialog';
import EffectRegulationPlayer from './EffectRegulationPlayer';
import { EffectFullscreenInduction } from './EffectFullscreenInduction';
import { EffectFullscreenVideoRegulation } from './EffectFullscreenVideoRegulation';
import { ConditionCountdown } from './EffectConditionCountdown';
import {
  EFFECT_CONDITION_OPTIONS,
  EFFECT_EMOTION_OPTIONS,
  EFFECT_METHOD_OPTIONS,
  type EffectEventLogStatus,
  type RegulationFinishMode,
} from './effectEvaluationFlow';
import { describeEventLogStatus } from './effectPipeline';
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

/** experiment event log chip shared by the induction, scale and condition panels. */
export function EventLogStatusChip({
  status,
  runId,
}: {
  status: EffectEventLogStatus;
  runId: string | null;
}) {
  if (status === 'not-started') {
    return null;
  }

  return (
    <div className={styles.pillRow}>
      <span
        role="status"
        className={`${styles.eventLogChip} ${
          status === 'saved'
            ? styles.eventLogSaved
            : status === 'active'
              ? styles.eventLogRecording
              : styles.eventLogUnavailable
        }`}
      >
        {status === 'saved'
          ? `✓ ${describeEventLogStatus(status)}${runId ? `（实验 ${`${runId.slice(0, 8)}…`}）` : ''}`
          : status === 'active'
            ? describeEventLogStatus(status)
            : `! ${describeEventLogStatus(status)}`}
      </span>
    </div>
  );
}

/** Trial-run hint shown atop the induction and condition interaction areas
 *  when the device was unavailable; the loop never blocks on it (the hook
 *  degrades the status to `unavailable` and keeps advancing). */
export function EventLogUnavailableHint() {
  return (
    <p className={styles.noteCallout} role="note">
      本次实验已中断。请重置后开始新实验，外部 BDF 由 ActiView 保存。
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
      <p className={styles.noteCallout}>
        实验模式、COM 连接及 ActiView 外部保存确认请先在实验设置中完成。正式实验不会自动降级为排练。
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
            onChange={(event) =>
              flow.updateDraft({ durationMinutes: Number(event.currentTarget.value) })
            }
          >
            {DURATION_MINUTE_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes}
              </option>
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
          label="实验条件:"
          options={EFFECT_CONDITION_OPTIONS.map(({ value, label }) => ({ value, label }))}
          selectedValue={state.condition}
          onSelect={(value) => flow.updateDraft({ condition: value })}
        />
        {state.condition === 'regulation' ? (
          <PillGroup
            label="调控手段:"
            options={EFFECT_METHOD_OPTIONS.map(({ value, label }) => ({ value, label }))}
            selectedValue={state.method}
            onSelect={(value) => flow.updateDraft({ method: value })}
          />
        ) : (
          <p className={styles.noteCallout} role="note">
            基线条件不播放调控素材。完成本次自然恢复后，可用同一被试和目标情绪再运行调控条件进行比较。
          </p>
        )}
        <p className={styles.noteCallout} role="note">
          实验条件说明：基线条件（自然恢复）＝情绪诱发后不施加调控手段，静息自然恢复；调控条件＝情绪诱发后施加所选调控手段（音乐/视频）。同被试同情绪完成两种条件各一次后，结果步会给出跨条件对比。
        </p>
      </div>

      {flow.actionError ? (
        <div className={styles.errorBanner} role="alert">
          {flow.actionError}
        </div>
      ) : null}

      <div className={styles.stagePrimaryRow}>
        <Button
          className={styles.primaryCta}
          variant="contained"
          disabled={state.subjectId.trim().length === 0 || flow.isStartingRun}
          onClick={flow.startBaselineMeasurement}
        >
          确认配置，开始诱发
        </Button>
        {/* The disabled CTA never guesses itself: say what is missing. */}
        {state.subjectId.trim().length === 0 ? (
          <p className={styles.stageHint} role="note">
            填写被试 ID 后即可开始。
          </p>
        ) : null}
      </div>
    </section>
  );
}

export type InductionStepPanelProps = {
  flow: EffectEvaluationFlow;
  eventLogUnavailableHint: ReactNode;
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
  eventLogUnavailableHint,
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
      {state.eventLogStatus === 'interrupted' ? eventLogUnavailableHint : null}

      {flow.actionError ? (
        <div className={styles.errorBanner} role="alert">
          {flow.actionError}
        </div>
      ) : null}

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
              onClick={() => navigate('/experiment-settings')}
            >
              前往 实验设置页处理素材库
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
            若素材库文件已缺失，请先到 实验设置页补齐素材库，或重置流程返回设置步。
          </Alert>
          <div className={styles.stageSecondaryRow}>
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={onRetryInductionVideo}
            >
              重试加载素材
            </button>
            <button type="button" className={styles.secondaryAction} onClick={onResetFlow}>
              重置并返回设置步
            </button>
          </div>
        </>
      ) : status.kind === 'ready' ? (
        <EffectFullscreenInduction
          entry={status.entry}
          isPlaying={isInductionPlaying}
          onError={onVideoError}
          onFinished={() => void flow.completeInduction()}
          onPlaying={() => flow.inductionOnset(status.entry.videoId)}
          startError={flow.actionError}
          isStarting={flow.isStartingRun}
          interrupted={state.interrupted}
          onReset={() => void flow.resetFlow()}
          onStartPlayback={onBeginInduction}
          retryCount={inductionRetryCount}
          subjectId={state.subjectId}
        />
      ) : null}

      <EventLogStatusChip status={state.eventLogStatus} runId={state.runId} />
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

      {flow.actionError ? (
        <div className={styles.errorBanner} role="alert">
          {flow.actionError}
        </div>
      ) : null}

      <div className={styles.stagePrimaryRow}>
        <Button
          className={styles.primaryCta}
          variant="contained"
          disabled={flow.isSavingScale || state.interrupted}
          onClick={onOpenDialog}
        >
          {flow.isSavingScale ? '正在保存量表…' : '开始填写'}
        </Button>
      </div>

      <EventLogStatusChip status={state.eventLogStatus} runId={state.runId} />

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
  eventLogUnavailableHint: ReactNode;
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
  eventLogUnavailableHint,
}: ConditionStepPanelProps) {
  const { state } = flow;
  const navigate = useNavigate();
  const [isVideoRegulationPrepared, setIsVideoRegulationPrepared] = useState(false);
  const isStarted = state.regulationStartedAtMs !== null;
  const [isVideoPlaybackRequested, setIsVideoPlaybackRequested] = useState(false);
  const isMusic = !isNaturalRecovery && state.method === 'music';
  const requiresVideoPool = state.method === 'video' && !isNaturalRecovery;
  const isVideoPresentationActive = requiresVideoPool && (isVideoRegulationPrepared || isStarted);

  return (
    <section className={styles.stageBody} aria-label="条件执行">
      {state.eventLogStatus === 'interrupted' ? eventLogUnavailableHint : null}

      {flow.actionError ? (
        <div className={styles.errorBanner} role="alert">
          {flow.actionError}
        </div>
      ) : null}

      {isMusic ? (
        <EffectRegulationPlayer
          method="music"
          remainingSeconds={isWindowElapsed ? 0 : null}
          interrupted={state.interrupted}
          onPlaying={flow.beginRegulation}
          onError={flow.playbackError}
        />
      ) : null}
      {isVideoPresentationActive ? (
        <EffectFullscreenVideoRegulation
          assets={
            flow.regulationPoolStatus.kind === 'ready' ? flow.regulationPoolStatus.entries : []
          }
          finishMode={finishMode}
          isPlaying={isVideoPlaybackRequested || isStarted}
          interrupted={state.interrupted}
          onReset={() => void flow.resetFlow()}
          onPlaying={flow.beginRegulation}
          onError={flow.playbackError}
          onFinish={onFinishRegulation}
          onSkip={onSkipRemaining}
          onStartPlayback={() => setIsVideoPlaybackRequested(true)}
          onWindowElapsed={onWindowElapsed}
          state={state}
          windowNoun={windowNoun}
        />
      ) : !isStarted ? (
        <>
          {requiresVideoPool && flow.isRegulationPoolLoading ? (
            <p className={`${styles.panelHint} ${styles.loadingHint}`}>正在加载平静调控素材库…</p>
          ) : requiresVideoPool && flow.regulationPoolStatus.kind === 'blocked' ? (
            <>
              <Alert severity="warning">{flow.regulationPoolStatus.copy}</Alert>
              <div className={styles.stageSecondaryRow}>
                <button
                  type="button"
                  className={styles.secondaryAction}
                  onClick={() => navigate('/experiment-settings')}
                >
                  前往 实验设置页处理素材库
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.stagePrimaryRow}>
                <Button
                  className={styles.primaryCta}
                  variant="contained"
                  disabled={state.interrupted || isMusic}
                  onClick={
                    requiresVideoPool
                      ? () => setIsVideoRegulationPrepared(true)
                      : () => flow.beginRegulation()
                  }
                >
                  {requiresVideoPool ? '进入全屏准备' : isNaturalRecovery ? '开始静息' : '开始调控'}
                </Button>
              </div>
              <p className={styles.panelHint}>
                自然恢复从开始静息计时；视频与音乐从实际播放开始计时。
              </p>
            </>
          )}
          <EventLogStatusChip status={state.eventLogStatus} runId={state.runId} />
        </>
      ) : (
        <>
          <ConditionCountdown state={state} windowNoun={windowNoun} onElapsed={onWindowElapsed} />

          {/* Embedded regulation media: the stage hosts the player itself;
              it pauses when the window elapsed and unmounts (stopping
              playback) if the operator jumps to the standalone page. The
              remaining-seconds prop carries the one-shot expiry fact
              (0 once elapsed, null before/while running) — the page does
              not track per-tick seconds. The natural-recovery condition
              has no media to play. */}
          {skippedCopy ? <Alert severity="warning">{skippedCopy}</Alert> : null}

          {state.method !== 'video' || isNaturalRecovery ? (
            <EventLogStatusChip status={state.eventLogStatus} runId={state.runId} />
          ) : null}

          {/* Strong duration constraint: the primary exit unlocks only at
              zero; leaving early rides the double-confirmed skip below. */}
          <div
            className={
              state.method === 'video' && !isNaturalRecovery
                ? styles.visuallyHidden
                : styles.stagePrimaryRow
            }
          >
            <Button
              className={styles.primaryCta}
              variant="contained"
              disabled={state.interrupted || finishMode.mode !== 'finish'}
              aria-describedby={
                finishMode.mode !== 'finish' ? 'regulation-countdown-hint' : undefined
              }
              onClick={onFinishRegulation}
            >
              {isNaturalRecovery ? '结束静息，进行复测' : '结束调控，进行复测'}
            </Button>
          </div>

          <div
            className={
              state.method === 'video' && !isNaturalRecovery
                ? styles.visuallyHidden
                : styles.stageSecondaryRow
            }
          >
            {isNaturalRecovery ? null : (
              <button
                type="button"
                className={styles.secondaryAction}
                onClick={flow.openRegulationPage}
              >
                在独立页打开{methodLabel}
              </button>
            )}
            {finishMode.mode === 'requires-skip' ? (
              <button
                type="button"
                className={styles.secondaryActionDanger}
                onClick={onSkipRemaining}
              >
                跳过剩余时长…
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
