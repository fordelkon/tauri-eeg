import SendRoundedIcon from '@mui/icons-material/SendRounded';
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded';
import { useEffect, useRef, useState } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { preloadMusicServiceForUser } from '../music/musicServicePreload';
import type { AgentTimelineEntry } from './agentContext';
import type { AgentPhase } from './agentFlow';
import { useExperimentAgent, type PendingAgentConfirmation } from './useExperimentAgent';
import styles from './ExperimentAgentPanel.module.css';

const formatThinkingSeconds = (durationMs: number) => `${(durationMs / 1000).toFixed(1)} s`;

/**
 * Idle-state guidance so the empty activity area reads as orientation rather
 * than dead space (R2-7): the input stays anchored to the panel bottom, and
 * this card fills the void until the first conversation entry replaces it.
 */
const phaseGuideItems: Record<AgentPhase, readonly string[]> = {
  intro: [
    '点击上方推荐操作，或直接输入“开始实验”',
    '助手会按 采集 → 调控 → 恢复 引导完整实验流程',
  ],
  baseline: [
    '启动设备后可开始或暂停基线采集',
    '采集数据由我协助停止并保存',
  ],
  video_regulation: [
    '让我播放一段放松视频',
    '也可以指定场景，例如“播放森林放松视频”',
  ],
  game_regulation: [
    '游戏调控暂未接入设备联动',
    '可以让我跳过本环节，继续后续流程',
  ],
  music_regulation: [
    '让我按当前状态生成一段调控音乐',
    '可以指定乐器与风格，例如“生成钢琴舒缓音乐”',
  ],
  recovery: [
    '临近流程尾声，可让我结束并保存数据',
    '结束前会先停止并保存 EEG 记录',
  ],
  finish: [
    '本次实验流程已完成',
    '可前往各功能页查看生成的记录',
  ],
};

/**
 * Owns the 250 ms "thinking elapsed" ticker: while the planner streams this
 * leaf re-renders 4x/s on its own, instead of dragging the whole panel
 * (timeline, quick prompts, form) through a re-render on every tick. The
 * displayed format matches the previous in-view countdown exactly.
 */
const ThinkingTimer = memo(function ThinkingTimer({
  isPlanning,
  durationMs,
}: {
  isPlanning: boolean;
  durationMs: number | null;
}) {
  const [liveThinkingMs, setLiveThinkingMs] = useState(0);

  useEffect(() => {
    if (!isPlanning) {
      setLiveThinkingMs(durationMs ?? 0);
      return undefined;
    }

    const planningStartedAt = Date.now();
    setLiveThinkingMs(0);

    const timerId = window.setInterval(() => {
      setLiveThinkingMs(Date.now() - planningStartedAt);
    }, 250);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isPlanning, durationMs]);

  return isPlanning
    ? `思考中 ${formatThinkingSeconds(liveThinkingMs)}`
    : `已思考 ${formatThinkingSeconds(durationMs ?? 0)}`;
});

let hasPreloadedMusicService = false;

type Props = {
  isPlannerAvailable: boolean;
  isPlanning: boolean;
  thinkingDurationMs: number | null;
  thinkingSteps: readonly string[];
  message: string;
  pendingConfirmation: PendingAgentConfirmation | null;
  phase: AgentPhase;
  quickPrompts: readonly string[];
  recentTimeline: readonly AgentTimelineEntry[];
  onConfirm: () => void;
  onReject: () => void;
  onSubmitPrompt: (value: string) => void;
  onCancel: () => void;
};

/**
 * Memoized so container-only re-renders (EEG/auth context churn, unrelated
 * hook state) skip the whole panel; every prop the container passes is
 * identity-stable between real content changes.
 */
const ExperimentAgentPanelView = memo(function ExperimentAgentPanelView({
  isPlannerAvailable,
  isPlanning,
  thinkingDurationMs,
  thinkingSteps,
  message,
  pendingConfirmation,
  phase,
  quickPrompts,
  recentTimeline,
  onConfirm,
  onReject,
  onSubmitPrompt,
  onCancel,
}: Props) {
  const [input, setInput] = useState('');
  const activityRef = useRef<HTMLDivElement | null>(null);
  // The live elapsed time is owned by the ThinkingTimer leaf below; the panel
  // itself no longer re-renders on its 250 ms tick.
  const thinkingSummary = (
    <ThinkingTimer isPlanning={isPlanning} durationMs={thinkingDurationMs} />
  );
  const thinkingClassName = isPlanning
    ? `${styles.thinking} ${styles.thinkingActive}`
    : styles.thinking;
  const visibleThinkingSteps = thinkingSteps.length > 0
    ? thinkingSteps
    : ['等待规划器响应。'];

  const submit = (value: string) => {
    const nextValue = value.trim();
    if (!nextValue) {
      return;
    }

    onSubmitPrompt(nextValue);
    setInput('');
  };

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const activity = activityRef.current;
      if (activity) {
        activity.scrollTop = activity.scrollHeight;
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [message, pendingConfirmation, recentTimeline]);

  return (
    <section className={styles.panel} aria-busy={isPlanning} aria-label="实验助手聊天">
      <div className={styles.header}>
        <div>
          <span>{isPlannerAvailable ? '智能可用' : '智能不可用'}</span>
          <strong>{phase}</strong>
        </div>
        <div className={styles.headerActions}>
          {isPlanning ? (
            <button type="button" className={styles.cancelButton} onClick={onCancel}>取消</button>
          ) : null}
          <SmartToyRoundedIcon fontSize="small" aria-hidden="true" />
        </div>
      </div>

      <div className={styles.content}>
      <div className={styles.promptGrid} aria-label="快捷指令示例">
        {Array.from(new Set(quickPrompts)).slice(0, 4).map((example) => (
          <button key={example} type="button" disabled={isPlanning} onClick={() => submit(example)}>
            {example}
          </button>
        ))}
      </div>

      {(isPlanning || thinkingDurationMs !== null || thinkingSteps.length > 0) ? (
        <details className={styles.thinkingPanel}>
          <summary className={thinkingClassName} role="status" aria-live="polite">
            <span aria-hidden="true" />
            <strong>{thinkingSummary}</strong>
          </summary>
          <ol className={styles.thinkingBody} aria-label="规划器思考步骤">
            {visibleThinkingSteps.map((step, index) => (
              <li key={`${index}-${step}`}>{step}</li>
            ))}
          </ol>
        </details>
      ) : null}

      <div className={styles.activity} ref={activityRef}>
      <p className={styles.message} aria-live="polite">{message}</p>

      {/* Empty-state guidance: only while nothing has happened yet, so the
          first timeline entry / thinking panel takes over the space. */}
      {recentTimeline.length === 0 && !isPlanning && thinkingDurationMs === null && !pendingConfirmation ? (
        <div className={styles.idleGuide} aria-label="助手使用指引">
          {phaseGuideItems[phase].map((item) => (
            <div key={item} className={styles.idleGuideItem}>
              <span aria-hidden="true" />
              {item}
            </div>
          ))}
        </div>
      ) : null}

      {recentTimeline.length > 0 ? (
        <ol className={styles.timeline} aria-label="最近助手记录">
          {recentTimeline.map((entry) => (
            <li key={`${entry.at}-${entry.type}`}>
              <span>{entry.type}</span>
              <strong>{entry.text}</strong>
            </li>
          ))}
        </ol>
      ) : null}

      {pendingConfirmation ? (
        <div className={styles.confirmation} role="alertdialog" aria-label={pendingConfirmation.label}>
          <strong>{pendingConfirmation.label}</strong>
          <div className={styles.confirmationActions}>
            <button type="button" onClick={onReject}>取消</button>
            <button type="button" onClick={onConfirm}>确认</button>
          </div>
        </div>
      ) : null}
      </div>

      </div>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
      >
        <input
          value={input}
          disabled={isPlanning}
          maxLength={100}
          placeholder="输入：下一步"
          aria-label="助手指令"
          onChange={(event) => setInput(event.currentTarget.value)}
        />
        <button type="submit" disabled={isPlanning} aria-label="发送助手指令">
          <SendRoundedIcon fontSize="small" />
        </button>
      </form>
    </section>
  );
});

type ContainerProps = {
  navigateTo: (path: string) => void;
};

export default function ExperimentAgentPanel({ navigateTo }: ContainerProps) {
  const location = useLocation();
  const { currentUser } = useAuth();
  const agent = useExperimentAgent({ pathname: location.pathname, navigateTo });

  useEffect(() => {
    if (hasPreloadedMusicService) {
      return;
    }

    hasPreloadedMusicService = true;
    void preloadMusicServiceForUser({ userId: currentUser?.id });
  }, [currentUser?.id]);

  // Stable handler identities so the memoized view is skipped by container
  // re-renders that do not change panel content.
  const handleConfirm = useCallback(
    () => void agent.confirmPendingAction(),
    [agent.confirmPendingAction],
  );
  const handleSubmitPrompt = useCallback(
    (value: string) => void agent.submitPrompt(value),
    [agent.submitPrompt],
  );

  // useExperimentAgent mints a fresh timeline slice on every render without
  // exposing `timeline` itself, so this memo keeps the previous slice while
  // its entries are all reference-identical; otherwise every container
  // render would mint a new prop and defeat the view memo.
  const recentTimelineRef = useRef<readonly AgentTimelineEntry[]>([]);
  const recentTimeline = useMemo(() => {
    const previous = recentTimelineRef.current;
    const next = agent.recentTimeline;

    if (previous.length === next.length && previous.every((entry, index) => entry === next[index])) {
      return previous;
    }

    recentTimelineRef.current = next;
    return next;
  }, [agent.recentTimeline]);

  return (
    <ExperimentAgentPanelView
      isPlannerAvailable={agent.isPlannerAvailable}
      isPlanning={agent.isPlanning}
      thinkingDurationMs={agent.thinkingDurationMs}
      thinkingSteps={agent.thinkingSteps}
      message={agent.message}
      pendingConfirmation={agent.pendingConfirmation}
      phase={agent.phase}
      quickPrompts={agent.quickPrompts}
      recentTimeline={recentTimeline}
      onConfirm={handleConfirm}
      onReject={agent.rejectPendingAction}
      onSubmitPrompt={handleSubmitPrompt}
      onCancel={agent.cancelPlanning}
    />
  );
}
