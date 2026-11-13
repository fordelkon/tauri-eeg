import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import InstrumentScaleDialog from '../../mentalScale/InstrumentScaleDialog';
import BriefRatingDialog from '../../mentalScale/BriefRatingDialog';
import EffectRegulationPlayer from './EffectRegulationPlayer';
import { EffectFullscreenInduction } from './EffectFullscreenInduction';
import { EffectFullscreenVideoRegulation } from './EffectFullscreenVideoRegulation';
import { ConditionCountdown } from './EffectConditionCountdown';
import type { RegulationFinishMode } from './effectEvaluationFlow';
import type { EffectEvaluationFlow } from './useEffectEvaluationFlow';
import styles from './EffectEvaluation.module.css';

export function EventLogUnavailableHint() {
  return (
    <p className={styles.noteCallout} role="note">
      本次实验已中断。请重置后开始新实验，外部 BDF 由 ActiView 保存。
    </p>
  );
}
export function SetupStepPanel() {
  const navigate = useNavigate();
  return (
    <section className={styles.stageBody} aria-label="准备本次评价">
      <Button
        className={styles.primaryCta}
        variant="contained"
        onClick={() => navigate('/experiment-settings')}
      >
        前往实验设置
      </Button>
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
          onReturnToSettings={state.runId ? undefined : () => navigate('/experiment-settings')}
          entry={status.entry}
          isPlaying={isInductionPlaying}
          onError={onVideoError}
          onFinished={() => void flow.completeInduction()}
          onPlaying={(onset) => flow.inductionOnset(status.entry.videoId, onset)}
          startError={flow.actionError}
          isStarting={flow.isStartingRun}
          interrupted={state.interrupted}
          onReset={() => void flow.resetFlow()}
          onStartPlayback={onBeginInduction}
          retryCount={inductionRetryCount}
        />
      ) : null}
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

      {isDialogOpen && state.protocol === 'brief' && state.runId ? (
        <BriefRatingDialog
          key={`${state.runId}-${phase}`}
          runId={state.runId}
          phase={phase}
          isSubmitting={flow.isSavingScale}
          submitError={flow.actionError}
          onClose={onCloseDialog}
          onComplete={(answers) => flow.completeScaleMeasurement(phase, answers)}
        />
      ) : isDialogOpen && state.protocol === 'full' ? (
        <InstrumentScaleDialog
          key={`scale-${phase}`}
          definition={flow.scaleDefinitionFor(phase)}
          isSubmitting={flow.isSavingScale}
          submitError={flow.actionError}
          onComplete={(answers) => {
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
  isWindowElapsed: boolean;
  onWindowElapsed: () => void;
  onFinishRegulation: () => void;
  onSkipRemaining: () => void;
  eventLogUnavailableHint: ReactNode;
};

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
            <p className={`${styles.panelHint} ${styles.loadingHint}`}>正在加载视频…</p>
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
                {isNaturalRecovery ? '点击开始后，请安静坐好。' : '素材开始播放后计时。'}
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <ConditionCountdown state={state} windowNoun={windowNoun} onElapsed={onWindowElapsed} />
          {skippedCopy ? <Alert severity="warning">{skippedCopy}</Alert> : null}

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
                disabled
                className={styles.secondaryAction}
                style={{ opacity: 0.6, cursor: 'not-allowed' }}
                title="实验进行中已锁定当前播放器"
                onClick={flow.openRegulationPage}
              >
                在独立页打开{methodLabel}（已锁定）
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
