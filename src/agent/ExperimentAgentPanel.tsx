import SendRoundedIcon from '@mui/icons-material/SendRounded';
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useEffect, useRef, useState } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { preloadMusicServiceForUser } from '../music/musicServicePreload';
import type { AgentTimelineEntry } from './agentContext';
import { agentActions } from './agentActions';
import { useExperimentAgent, type PendingAgentConfirmation } from './useExperimentAgent';
import styles from './ExperimentAgentPanel.module.css';

const formatThinkingSeconds = (durationMs: number) => `${(durationMs / 1000).toFixed(1)} s`;

const entryLabels: Record<AgentTimelineEntry['type'], string> = {
  action: '操作',
  confirmation: '确认',
  planner: '助手',
  message: '你',
};

function displayEntry(entry: AgentTimelineEntry): string {
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
  thinkingSteps: readonly string[];
  message: string;
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
  thinkingDurationMs,
  thinkingSteps,
  message,
  pendingConfirmation,
  quickPrompts,
  recentTimeline,
  onConfirm,
  onReject,
  onSubmitPrompt,
  onCancel,
}: Props) {
  const [input, setInput] = useState('');
  const [showPrompts, setShowPrompts] = useState(false);
  const activityRef = useRef<HTMLDivElement | null>(null);
  // The live elapsed time is owned by the ThinkingTimer leaf below; the panel
  // itself no longer re-renders on its 250 ms tick.
  const thinkingSummary = <ThinkingTimer isPlanning={isPlanning} durationMs={thinkingDurationMs} />;
  const thinkingClassName = isPlanning
    ? `${styles.thinking} ${styles.thinkingActive}`
    : styles.thinking;
  const visibleThinkingSteps = thinkingSteps.length > 0 ? thinkingSteps : ['等待规划器响应。'];
  const hasThinkingDetails =
    isPlanning || thinkingSteps.length > 0 || (thinkingDurationMs ?? 0) >= 250;

  const submit = (value: string) => {
    const nextValue = value.trim();
    if (!nextValue) {
      return;
    }

    onSubmitPrompt(nextValue);
    setInput('');
    setShowPrompts(false);
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
    <section
      className={styles.panel}
      data-idle={
        !recentTimeline.length &&
        !message &&
        !pendingConfirmation &&
        !isPlanning &&
        thinkingDurationMs === null
      }
      aria-busy={isPlanning}
      aria-label="实验助手聊天"
    >
      <div className={styles.header}>
        <h2>
          <SmartToyRoundedIcon fontSize="small" aria-hidden="true" />
          实验助手
        </h2>
        <div className={styles.headerActions}>
          {isPlanning ? (
            <button type="button" className={styles.cancelButton} onClick={onCancel}>
              取消
            </button>
          ) : (
            <span className={styles.availability} data-available={isPlannerAvailable}>
              {isPlannerAvailable ? '可用' : '本地指令'}
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
                onClick={() => submit(example)}
              >
                {example}
              </button>
            ))}
        </div>

        {hasThinkingDetails ? (
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
          {recentTimeline.length > 0 ? (
            <ol className={styles.timeline} aria-label="最近助手记录">
              {recentTimeline.map((entry) => (
                <li key={`${entry.at}-${entry.type}`} data-kind={entry.type}>
                  <span>{entryLabels[entry.type]}</span>
                  <strong>{displayEntry(entry)}</strong>
                </li>
              ))}
            </ol>
          ) : null}
          <p className={styles.message} aria-live="polite">
            {recentTimeline[recentTimeline.length - 1]?.text === message ? '' : message}
          </p>

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
        <input
          value={input}
          disabled={isPlanning}
          maxLength={100}
          placeholder="输入实验指令…"
          aria-label="助手指令"
          onChange={(event) => setInput(event.currentTarget.value)}
        />
        <button type="submit" disabled={isPlanning || !input.trim()} aria-label="发送助手指令">
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
  // re-renders that do not change panel content. The hook's callbacks are
  // useCallback-stable, so destructuring keeps the identities without
  // depending on the per-render `agent` object itself.
  const { confirmPendingAction, submitPrompt } = agent;
  const handleConfirm = useCallback(() => void confirmPendingAction(), [confirmPendingAction]);
  const handleSubmitPrompt = useCallback(
    (value: string) => void submitPrompt(value),
    [submitPrompt],
  );

  // useExperimentAgent mints a fresh timeline slice on every render without
  // exposing `timeline` itself, so this memo keeps the previous slice while
  // its entries are all reference-identical; otherwise every container
  // render would mint a new prop and defeat the view memo.
  const recentTimelineRef = useRef<readonly AgentTimelineEntry[]>([]);
  const recentTimeline = useMemo(() => {
    const previous = recentTimelineRef.current;
    const next = agent.recentTimeline;

    if (
      previous.length === next.length &&
      previous.every((entry, index) => entry === next[index])
    ) {
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
      quickPrompts={agent.quickPrompts}
      recentTimeline={recentTimeline}
      onConfirm={handleConfirm}
      onReject={agent.rejectPendingAction}
      onSubmitPrompt={handleSubmitPrompt}
      onCancel={agent.cancelPlanning}
    />
  );
}
