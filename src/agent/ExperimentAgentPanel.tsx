import SendRoundedIcon from '@mui/icons-material/SendRounded';
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useEffect, useRef, useState } from 'react';
import { memo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { preloadMusicServiceForUser } from '../music/musicServicePreload';
import type { AgentTimelineEntry } from './agentContext';
import { agentActions } from './agentActions';
import {
  useExperimentAgent,
  type PendingAgentConfirmation,
  type UseExperimentAgentOptions,
} from './useExperimentAgent';
import styles from './ExperimentAgentPanel.module.css';

const formatThinkingSeconds = (durationMs: number) => `${(durationMs / 1000).toFixed(1)} s`;

const entryLabels: Record<AgentTimelineEntry['type'], string> = {
  action: '操作',
  confirmation: '确认',
  planner: '助手',
  message: '你',
};

function displayEntry(entry: AgentTimelineEntry): string {
  if (entry.type === 'planner' && entry.text.startsWith('recommend_music:')) {
    const style = entry.text.slice('recommend_music:'.length).split('|')[0].trim();
    return style ? `推荐的音乐风格为 ${style}。` : '已选出推荐的音乐风格。';
  }
  if (entry.type === 'planner' && entry.text.startsWith('recommend_video:')) {
    return '已从当前素材中选出推荐视频。';
  }
  if (entry.type !== 'action' && entry.type !== 'confirmation') return entry.text;
  const [id, ...details] = entry.text.split(':');
  const label = agentActions.find((action) => action.id === id)?.label;
  return label ? [label, ...details].join('：') : entry.text;
}

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
  isRequestingPlanner: boolean;
  thinkingSteps: readonly string[];
  pathname: string;
  pendingConfirmation: PendingAgentConfirmation | null;
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
  isRequestingPlanner,
  thinkingDurationMs,
  thinkingSteps,
  pathname,
  pendingConfirmation,
  quickPrompts,
  recentTimeline,
  onConfirm,
  onReject,
  onSubmitPrompt,
  onCancel,
}: Props) {
  const [input, setInput] = useState('');
  const [showPrompts, setShowPrompts] = useState(true);
  const activityRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastCompositionEnd = useRef(-Infinity);
  const followLatest = useRef(true);
  // The live elapsed time is owned by the ThinkingTimer leaf below; the panel
  // itself no longer re-renders on its 250 ms tick.
  const thinkingSummary = (
    <ThinkingTimer isPlanning={isRequestingPlanner} durationMs={thinkingDurationMs} />
  );
  const thinkingClassName = isRequestingPlanner
    ? `${styles.thinking} ${styles.thinkingActive}`
    : styles.thinking;
  const visibleThinkingSteps =
    thinkingSteps.length > 0
      ? thinkingSteps
      : [isRequestingPlanner ? '等待规划器响应。' : '本次请求没有更多步骤。'];
  const hasThinkingDetails =
    isRequestingPlanner || thinkingSteps.length > 0 || (thinkingDurationMs ?? 0) >= 250;

  const submit = (value: string, fromShortcut = false) => {
    const nextValue = value.trim();
    if (!nextValue || isPlanning) {
      return;
    }

    followLatest.current = true;
    onSubmitPrompt(nextValue);
    if (!fromShortcut) {
      setInput('');
      inputRef.current?.focus();
    }
  };

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const activity = activityRef.current;
      if (activity && followLatest.current) {
        activity.scrollTop = activity.scrollHeight;
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [pendingConfirmation, recentTimeline, isPlanning]);

  return (
    <section className={styles.panel} aria-busy={isPlanning} aria-label="实验助手聊天">
      <div className={styles.header}>
        <h2>
          <SmartToyRoundedIcon fontSize="small" aria-hidden="true" />
          实验助手
        </h2>
        <div className={styles.headerActions}>
          {isRequestingPlanner ? (
            <button type="button" className={styles.cancelButton} onClick={onCancel}>
              取消
            </button>
          ) : (
            <span className={styles.availability} data-available={isPlannerAvailable}>
              {isPlanning ? '执行中' : isPlannerAvailable ? '可用' : '本地指令'}
            </span>
          )}
        </div>
      </div>

      <div className={styles.content}>
        <button
          type="button"
          className={styles.promptToggle}
          aria-expanded={showPrompts}
          aria-controls="assistant-examples"
          onClick={() => setShowPrompts(!showPrompts)}
        >
          快捷指令
          <ExpandMoreRoundedIcon fontSize="small" aria-hidden="true" />
        </button>
        <div
          id="assistant-examples"
          className={styles.promptGrid}
          aria-label="快捷指令示例"
          hidden={!showPrompts}
        >
          {Array.from(new Set(quickPrompts))
            .slice(0, 4)
            .map((example) => (
              <button
                key={example}
                type="button"
                disabled={isPlanning}
                onClick={() => submit(example, true)}
              >
                {example}
              </button>
            ))}
        </div>

        {hasThinkingDetails ? (
          <details className={styles.thinkingPanel} key={`${pathname}-${isRequestingPlanner}`}>
            <summary className={thinkingClassName}>
              <span aria-hidden="true" />
              <strong>{thinkingSummary}</strong>
              <ExpandMoreRoundedIcon aria-hidden="true" fontSize="small" />
            </summary>
            <ol className={styles.thinkingBody} aria-label="规划器思考步骤">
              {visibleThinkingSteps.map((step, index) => (
                <li key={`${index}-${step}`}>{step}</li>
              ))}
            </ol>
          </details>
        ) : null}

        <div
          className={styles.activity}
          ref={activityRef}
          onScroll={(event) => {
            const activity = event.currentTarget;
            followLatest.current =
              activity.scrollHeight - activity.clientHeight - activity.scrollTop < 24;
          }}
        >
          {recentTimeline.length > 0 ? (
            <ol className={styles.timeline} role="log" aria-label="最近助手记录" aria-live="polite">
              {recentTimeline.map((entry) => (
                <li key={`${entry.at}-${entry.type}`} data-kind={entry.type}>
                  <span>{entryLabels[entry.type]}</span>
                  <strong>{displayEntry(entry)}</strong>
                </li>
              ))}
            </ol>
          ) : null}

          {pendingConfirmation ? (
            <div
              className={styles.confirmation}
              role="alertdialog"
              aria-label={pendingConfirmation.label}
            >
              <strong>{pendingConfirmation.label}</strong>
              <div className={styles.confirmationActions}>
                <button type="button" onClick={onReject}>
                  取消
                </button>
                <button type="button" onClick={onConfirm}>
                  确认
                </button>
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
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          maxLength={1000}
          placeholder="输入实验指令…"
          aria-label="助手指令"
          title="Enter 发送，Shift+Enter 换行"
          onCompositionEnd={() => {
            lastCompositionEnd.current = performance.now();
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            event.preventDefault();
            if (performance.now() - lastCompositionEnd.current < 500) return;
            submit(input);
          }}
          onChange={(event) => setInput(event.currentTarget.value)}
        />
        <button type="submit" disabled={isPlanning || !input.trim()} aria-label="发送助手指令">
          <SendRoundedIcon fontSize="small" />
        </button>
      </form>
    </section>
  );
});

type ContainerProps = Pick<UseExperimentAgentOptions, 'navigateTo'>;

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
  // re-renders that do not change panel content. The hook's callbacks are
  // useCallback-stable, so destructuring keeps the identities without
  // depending on the per-render `agent` object itself.
  const { confirmPendingAction, submitPrompt } = agent;
  const handleConfirm = useCallback(() => void confirmPendingAction(), [confirmPendingAction]);
  const handleSubmitPrompt = useCallback(
    (value: string) => void submitPrompt(value),
    [submitPrompt],
  );

  return (
    <ExperimentAgentPanelView
      isPlannerAvailable={agent.isPlannerAvailable}
      isPlanning={agent.isPlanning}
      isRequestingPlanner={agent.isRequestingPlanner}
      thinkingDurationMs={agent.thinkingDurationMs}
      thinkingSteps={agent.thinkingSteps}
      pathname={location.pathname}
      pendingConfirmation={agent.pendingConfirmation}
      quickPrompts={agent.quickPrompts}
      recentTimeline={agent.recentTimeline}
      onConfirm={handleConfirm}
      onReject={agent.rejectPendingAction}
      onSubmitPrompt={handleSubmitPrompt}
      onCancel={agent.cancelPlanning}
    />
  );
}
