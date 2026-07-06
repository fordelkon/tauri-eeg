import SendRoundedIcon from '@mui/icons-material/SendRounded';
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded';
import { useEffect, useRef, useState } from 'react';
import type { AgentTimelineEntry } from './agentContext';
import type { AgentPhase } from './agentFlow';
import type { PendingAgentConfirmation } from './useExperimentAgent';
import styles from './ExperimentAgentPanel.module.css';

const formatThinkingSeconds = (durationMs: number) => `${(durationMs / 1000).toFixed(1)} s`;

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
};

export default function ExperimentAgentPanel({
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
}: Props) {
  const [input, setInput] = useState('');
  const [liveThinkingMs, setLiveThinkingMs] = useState(0);
  const activityRef = useRef<HTMLDivElement | null>(null);
  const thinkingSummary = isPlanning
    ? `思考中 ${formatThinkingSeconds(liveThinkingMs)}`
    : `已思考 ${formatThinkingSeconds(thinkingDurationMs ?? 0)}`;
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

  useEffect(() => {
    if (!isPlanning) {
      setLiveThinkingMs(thinkingDurationMs ?? 0);
      return undefined;
    }

    const planningStartedAt = Date.now();
    setLiveThinkingMs(0);

    const timerId = window.setInterval(() => {
      setLiveThinkingMs(Date.now() - planningStartedAt);
    }, 100);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isPlanning, thinkingDurationMs]);

  return (
    <section className={styles.panel} aria-busy={isPlanning} aria-label="实验助手聊天">
      <div className={styles.header}>
        <div>
          <span>{isPlannerAvailable ? '智能可用' : '智能不可用'}</span>
          <strong>{phase}</strong>
        </div>
        <SmartToyRoundedIcon fontSize="small" aria-hidden="true" />
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
          onChange={(event) => setInput(event.currentTarget.value)}
        />
        <button type="submit" disabled={isPlanning} aria-label="发送助手指令">
          <SendRoundedIcon fontSize="small" />
        </button>
      </form>
    </section>
  );
}
