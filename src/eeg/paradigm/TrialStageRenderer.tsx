import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toPlayableVideoUrl } from '../../video/videoRegulationCatalog';
import {
  VIDEO_LOAD_WATCHDOG_MS,
  VIDEO_MAX_SECONDS,
  VIDEO_MIN_SECONDS,
  coalesceCountdownTickMs,
  getTimedPhaseDurationMs,
  isVideoDurationOutOfRange,
} from './paradigmTimeline';
import { PARADIGM_TRIALS_PER_CLASS } from './types';
import type { ParadigmTrialPlanItem } from './types';
import styles from './ParadigmSession.module.css';

export type TrialStagePhase =
  | 'baseline'
  | 'hint'
  | 'video'
  | 'regulationCue'
  | 'regulationWindow'
  | 'feedback'
  | 'postRest';

/** A retry affordance rendered beside a stage notice's message. */
export type TrialStageNoticeAction = {
  label: string;
  onClick: () => void;
};

export type TrialStageNotice = {
  message: string;
  /**
   * Retry buttons rendered inside the fullscreen stage. The panel-level
   * error banner mounts inside .content, whose transform-created stacking
   * context keeps it below these body-level portals — so without actions
   * here, command failures during a fullscreen stage are dead ends.
   */
  actions?: readonly TrialStageNoticeAction[];
};

/**
 * Simulated (or, later, real) decoder scores shown on the intermittent
 * feedback stage: the gray bar is the target proximity during the induction
 * video, the green bar the proximity reached during the regulation window.
 */
export type TrialStageFeedback = {
  baselineScore: number;
  regulationScore: number;
};

type Props = {
  phase: TrialStagePhase;
  plan: ParadigmTrialPlanItem;
  /** Corner progress, e.g. "视频 3 / 5"; never names the emotion class. */
  trialLabel: string;
  /** 1-based position of the upcoming/playing video inside its block. */
  videoNumber?: number;
  /** Decoder scores shown only on the regulation feedback stage. */
  feedback?: TrialStageFeedback | null;
  /** Operator escape hatch rendered as a subtle fullscreen corner button. */
  onRequestEarlyEnd: () => void;
  /** Fired when a countdown-driven phase reaches zero. */
  onCountdownComplete: () => void;
  /** Fired once per trial when the video actually starts playing. */
  onVideoFirstPlay: () => void;
  onVideoEnded: () => void;
  onVideoDurationLoaded: (durationSeconds: number | null) => void;
  /** Retires the active trial after a load failure and moves to the next one. */
  onSkipTrial: () => void;
  /**
   * Command failures surfaced inside the fullscreen stage; the panel-level
   * error banner sits behind the portal and would otherwise be invisible.
   */
  stageNotice?: TrialStageNotice | null;
};

const COUNTDOWN_TICK_MS = 100;

const stageCopy: Record<Exclude<TrialStagePhase, 'video'>, { title: string; hint: string }> = {
  baseline: {
    hint: '静息放松,减少眨眼与头动',
    title: '静息基线',
  },
  hint: {
    hint: '即将播放视频,请保持注视屏幕',
    title: '准备播放',
  },
  regulationCue: {
    hint: '视频结束,请准备重新解读刚才的内容',
    title: '调控提示',
  },
  regulationWindow: {
    hint: '请运用认知重评策略,让自己逐渐平静下来',
    title: '情绪调控中',
  },
  feedback: {
    hint: '灰条 = 观看视频时的状态,彩条 = 调控后的脑状态接近度',
    title: '调控反馈',
  },
  postRest: {
    hint: '视频播放结束,继续保持静息放松,减少眨眼与头动',
    title: '静息恢复',
  },
};

export default function TrialStageRenderer({
  phase,
  plan,
  trialLabel,
  videoNumber,
  feedback = null,
  onRequestEarlyEnd,
  onCountdownComplete,
  onVideoFirstPlay,
  onVideoEnded,
  onVideoDurationLoaded,
  onSkipTrial,
  stageNotice,
}: Props) {
  const durationMs = getTimedPhaseDurationMs(phase);
  const [remainingMs, setRemainingMs] = useState(durationMs ?? 0);
  const completedRef = useRef(false);

  useEffect(() => {
    completedRef.current = false;

    if (durationMs === null) {
      setRemainingMs(0);
      return undefined;
    }

    const startedAtMs = Date.now();
    setRemainingMs(durationMs);

    const interval = window.setInterval(() => {
      const remaining = durationMs - (Date.now() - startedAtMs);
      if (remaining <= 0) {
        window.clearInterval(interval);
        setRemainingMs(0);
        if (!completedRef.current) {
          completedRef.current = true;
          onCountdownComplete();
        }
        return;
      }
      // The rendered value only moves once per second; keeping the stored
      // value on unchanged ceilings lets React bail out of the update, so the
      // fullscreen portal subtree re-renders at 1 Hz instead of every tick.
      setRemainingMs((current) => coalesceCountdownTickMs(current, remaining));
    }, COUNTDOWN_TICK_MS);

    return () => {
      window.clearInterval(interval);
    };
    // The countdown must only restart when the stage itself changes; parent
    // re-renders (e.g. error banners) must not reset the trial timing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, durationMs]);

  if (phase === 'video') {
    return createPortal(
      <div className={styles.stageHost} aria-label="情绪诱发视频播放区">
        <StageCorners trialLabel={trialLabel} onRequestEarlyEnd={onRequestEarlyEnd} />
        {stageNotice ? <StageNoticeBar notice={stageNotice} /> : null}
        <VideoStage
          key={plan.videoId}
          plan={plan}
          onVideoFirstPlay={onVideoFirstPlay}
          onVideoEnded={onVideoEnded}
          onVideoDurationLoaded={onVideoDurationLoaded}
          onSkipTrial={onSkipTrial}
        />
      </div>,
      // Portal past the app shell: its entrance animations leave lingering
      // transforms that would otherwise turn this fixed stage into a box
      // embedded in the layout instead of covering the viewport.
      document.body,
    );
  }

  const copy = stageCopy[phase];
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  // The hint stage doubles as the "next video coming up" cue with the
  // within-block position, so the subject always knows what is coming.
  const hintText = phase === 'hint' && typeof videoNumber === 'number'
    ? `即将播放第 ${videoNumber} / ${PARADIGM_TRIALS_PER_CLASS} 个视频,请保持注视屏幕`
    : copy.hint;

  return createPortal(
    <div className={styles.stageHost} aria-label={copy.title}>
      <StageCorners trialLabel={trialLabel} onRequestEarlyEnd={onRequestEarlyEnd} />
      {stageNotice ? <StageNoticeBar notice={stageNotice} /> : null}
      {phase === 'baseline' || phase === 'hint' ? <PreheatVideo plan={plan} /> : null}
      <div className={styles.stageMessage}>
        {phase === 'baseline' ? <span className={styles.fixationCross} aria-hidden="true" /> : null}
        <span className={styles.stageTitle}>{copy.title}</span>
        <span className={styles.stageHintText}>{hintText}</span>
        {phase === 'feedback' && feedback ? (
          <FeedbackBars baselineScore={feedback.baselineScore} regulationScore={feedback.regulationScore} />
        ) : (
          <span className={styles.stageCountdown} aria-label="剩余秒数">{remainingSeconds}</span>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Intermittent feedback display (shown for the whole 2 s feedback stage):
 * two horizontal proximity bars — gray reference (induction baseline) vs
 * green current (regulation) — plus the signed R = regulation − baseline
 * delta badge. Kept deliberately plain so a real decoder can drive the same
 * markup without redesign.
 */
function FeedbackBars({
  baselineScore,
  regulationScore,
}: TrialStageFeedback) {
  const toPercent = (score: number) => `${Math.round(Math.min(1, Math.max(0, score)) * 100)}%`;
  const delta = regulationScore - baselineScore;
  const improved = delta >= 0;

  return (
    <div className={styles.feedbackBars} aria-label="调控反馈">
      <div className={styles.feedbackBarRow}>
        <span className={styles.feedbackBarLabel}>观看时</span>
        <span className={styles.feedbackBarTrack}>
          <span
            className={`${styles.feedbackBarFill} ${styles.feedbackBarFillBaseline}`}
            style={{ transform: `scaleX(${Math.min(1, Math.max(0, baselineScore))})` }}
          />
        </span>
        <span className={styles.feedbackBarValue}>{toPercent(baselineScore)}</span>
      </div>
      <div className={styles.feedbackBarRow}>
        <span className={styles.feedbackBarLabel}>调控后</span>
        <span className={styles.feedbackBarTrack}>
          <span
            className={`${styles.feedbackBarFill} ${styles.feedbackBarFillTarget}`}
            style={{ transform: `scaleX(${Math.min(1, Math.max(0, regulationScore))})` }}
          />
        </span>
        <span className={styles.feedbackBarValue}>{toPercent(regulationScore)}</span>
      </div>
      <span
        className={`${styles.feedbackDeltaBadge} ${improved ? styles.feedbackDeltaUp : styles.feedbackDeltaDown}`}
      >
        {improved ? '▲' : '▼'} {Math.abs(delta).toFixed(2)}
      </span>
    </div>
  );
}

/**
 * Command-failure bar for the fullscreen stage: the message plus any retry
 * actions. Exported because ParadigmRunner's own interTrial/qualityCheck
 * portals mount the same stage outside this renderer.
 */
export function StageNoticeBar({ notice }: { notice: TrialStageNotice }) {
  return (
    <div className={styles.stageNoticeBar} role="alert">
      <span>{notice.message}</span>
      {(notice.actions ?? []).map((action) => (
        <button
          key={action.label}
          type="button"
          className={styles.stageActionButton}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

function StageCorners({
  trialLabel,
  onRequestEarlyEnd,
}: {
  trialLabel: string;
  onRequestEarlyEnd: () => void;
}) {
  return (
    <>
      <span className={styles.stageTrialLabel}>{trialLabel}</span>
      <button type="button" className={styles.stageEndButton} onClick={onRequestEarlyEnd}>
        结束
      </button>
    </>
  );
}

/**
 * Hidden player that pre-warms the imminent video during the baseline+hint
 * lead-in (7 s): file open, container probing, and decoder init happen while
 * the countdown runs instead of after the stage flips to black. It mounts the
 * exact URL the real VideoStage will request (same toPlayableVideoUrl
 * conversion), so the formal mount hits the warm HTTP/OS cache.
 *
 * preload="auto" only buffers — nothing plays; muted keeps it silent even if
 * a browser quirk decoded audio. No handlers: the timeline marks stay owned by
 * the real player (video mark still fires on its actual onPlay). Cleanup is
 * the conditional render itself — unmounting drops the element and its
 * resources when the video stage takes over.
 */
function PreheatVideo({ plan }: { plan: ParadigmTrialPlanItem }) {
  return (
    <video
      key={plan.videoId}
      className={styles.stagePreheatVideo}
      src={toPlayableVideoUrl(plan.videoPath, convertFileSrc)}
      preload="auto"
      muted
      aria-hidden="true"
    />
  );
}

type VideoStageProps = {
  plan: ParadigmTrialPlanItem;
  onVideoFirstPlay: () => void;
  onVideoEnded: () => void;
  onVideoDurationLoaded: (durationSeconds: number | null) => void;
  onSkipTrial: () => void;
};

function VideoStage({
  plan,
  onVideoFirstPlay,
  onVideoEnded,
  onVideoDurationLoaded,
  onSkipTrial,
}: VideoStageProps) {
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Bumped on retry so the <video> element remounts and re-issues the request.
  const [retryToken, setRetryToken] = useState(0);
  const firstPlayRef = useRef(false);
  // Set once the video demonstrably advances; disarms the watchdog.
  const playbackAdvancedRef = useRef(false);

  useEffect(() => {
    if (loadFailed) {
      return undefined;
    }

    playbackAdvancedRef.current = false;
    // A missing file usually fires onError, but some failure modes never do
    // (404 served as a decodable-empty response, stalled decoder, blocked
    // autoplay): without this fallback the fullscreen stage stays black until
    // the operator ends the whole session. The spec's max duration plus grace
    // keeps slow disk/codec starts from tripping it.
    const timer = window.setTimeout(() => {
      if (!playbackAdvancedRef.current) {
        setLoadFailed(true);
      }
    }, VIDEO_LOAD_WATCHDOG_MS);

    return () => window.clearTimeout(timer);
  }, [loadFailed, plan.videoId, retryToken]);

  const handleRetry = () => {
    firstPlayRef.current = false;
    setDurationSeconds(null);
    setLoadFailed(false);
    setRetryToken((token) => token + 1);
  };

  return (
    <>
      <video
        key={retryToken}
        ref={(node) => {
          if (node) {
            // Volume is fixed by the paradigm spec; the subject cannot change
            // it and the operator sees no controls.
            node.volume = 1;
          }
        }}
        className={styles.stageVideo}
        src={toPlayableVideoUrl(plan.videoPath, convertFileSrc)}
        autoPlay
        playsInline
        onPlay={() => {
          if (!firstPlayRef.current) {
            firstPlayRef.current = true;
            onVideoFirstPlay();
          }
        }}
        onTimeUpdate={() => {
          playbackAdvancedRef.current = true;
        }}
        onError={() => setLoadFailed(true)}
        onLoadedMetadata={(event) => {
          const seconds = event.currentTarget.duration;
          const safeSeconds = Number.isFinite(seconds) ? seconds : null;
          setDurationSeconds(safeSeconds);
          onVideoDurationLoaded(safeSeconds);
        }}
        onEnded={() => onVideoEnded()}
      />
      {durationSeconds !== null && isVideoDurationOutOfRange(durationSeconds) ? (
        <span className={styles.stageVideoBadge}>
          视频时长超出 {VIDEO_MIN_SECONDS}-{VIDEO_MAX_SECONDS} 秒范围(实际 {Math.round(durationSeconds)} 秒)
        </span>
      ) : null}
      {loadFailed ? (
        <div className={styles.stageVideoErrorBar} role="alert">
          <span>视频加载失败,无法播放(文件缺失或格式不受支持)。</span>
          <button type="button" className={styles.stageActionButton} onClick={handleRetry}>
            重试
          </button>
          <button
            type="button"
            className={`${styles.stageActionButton} ${styles.stageDangerActionButton}`}
            onClick={onSkipTrial}
          >
            跳过该试次
          </button>
        </div>
      ) : null}
    </>
  );
}
