import { formatCountdown } from './effectEvaluationFlow';
import type { RegulationPageContext } from './effectEvaluationFlow';

/**
 * Shared "效果评价调控进行中" session banner for the standalone regulation
 * pages (music / video). While the effect-evaluation wizard's step-3 window
 * is live on that page (R4/F4), the banner names the target emotion and the
 * remaining time; once the window has run to zero it tells the operator to
 * return to the wizard for the re-test. The styling stays with each page via
 * the `className` prop (each page's CSS module carries .effectSessionBanner).
 */
export function RegulationSessionBanner({
  context,
  className,
}: {
  context: RegulationPageContext | null;
  className: string;
}) {
  if (context === null) {
    return null;
  }

  const regulationElapsed = context.remainingSeconds === 0;

  return (
    <div className={className} role="status">
      {regulationElapsed
        ? '效果评价调控时长已达成，播放已自动停止。请回到「效果评价」页继续复测。'
        : `效果评价调控进行中 · 目标情绪 ${context.emotionLabel} · 剩余时长 ${formatCountdown(context.remainingSeconds)}`}
    </div>
  );
}
