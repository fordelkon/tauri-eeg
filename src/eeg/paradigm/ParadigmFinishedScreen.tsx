import { useNavigate } from 'react-router-dom';
import {
  paradigmEmotionLabels,
  trialQualityLabels,
} from './types';
import type { ParadigmSessionSummary } from './types';
import type { RegulationFeedbackSummary } from './regulationFeedbackSim';
import styles from './ParadigmSession.module.css';

/**
 * Finished-screen of the paradigm runner: the 训练前统计 summary table, the
 * dry-run regulation feedback statistics, warnings, and the two exits
 * (back to setup, or onward to the effect-evaluation wizard — the finished
 * screen handoff reads the shared subject memory, so the link needs nothing
 * but the route).
 */

type ParadigmFinishedScreenProps = {
  dryRun: boolean;
  summary: ParadigmSessionSummary | null;
  summaryError: string | null;
  /** Dry-run regulation summary (simulated decoder statistics); null otherwise. */
  regulationSummary: RegulationFeedbackSummary | null;
  sessionId: string | null;
  onReturnToSetup: () => void;
};

export default function ParadigmFinishedScreen({
  dryRun,
  summary,
  summaryError,
  regulationSummary,
  sessionId,
  onReturnToSetup,
}: ParadigmFinishedScreenProps) {
  const navigate = useNavigate();

  return (
    <div className={styles.panel} aria-label="范式 Session 训练前统计">
      <header className={styles.dialogHeader}>
        <p className={styles.dialogEyebrow}>Session 完成</p>
        <h2 className={styles.dialogTitle}>训练前统计</h2>
        <p className={styles.dialogDescription}>
          {dryRun
            ? '试运行结束,未写入任何数据。'
            : `连续记录已自动停止。Session ID:${summary?.sessionId ?? sessionId ?? '未知'}`}
        </p>
      </header>

      {summaryError ? <div className={styles.errorBanner}>{summaryError}</div> : null}

      {summary ? (
        <>
          <table className={styles.summaryTable}>
            <thead>
              <tr>
                <th>情绪</th>
                <th>{trialQualityLabels.accepted}</th>
                <th>{trialQualityLabels.uncertain}</th>
                <th>{trialQualityLabels.rejected}</th>
                <th>{trialQualityLabels.artifact_rejected}</th>
                <th>中断</th>
              </tr>
            </thead>
            <tbody>
              {summary.perClass
                .filter((row) => (
                  row.accepted
                  + row.uncertain
                  + row.rejected
                  + row.artifactRejected
                  + row.interrupted
                  > 0
                ))
                .map((row) => (
                  <tr key={row.emotion}>
                    <td>{paradigmEmotionLabels[row.emotion]}</td>
                    <td>{row.accepted}</td>
                    <td>{row.uncertain}</td>
                    <td>{row.rejected}</td>
                    <td>{row.artifactRejected}</td>
                    <td>{row.interrupted}</td>
                  </tr>
                ))}
            </tbody>
          </table>

          <div className={styles.summaryMeans}>
            <span>共 {summary.totalTrials} 个试次</span>
            <span>愉悦度均值 {summary.valenceMean === null ? '—' : summary.valenceMean.toFixed(2)}</span>
            <span>唤醒度均值 {summary.arousalMean === null ? '—' : summary.arousalMean.toFixed(2)}</span>
          </div>

          {regulationSummary ? (
            <div className={styles.regulationSummary} aria-label="调控反馈统计">
              <h3 className={styles.regulationSummaryTitle}>模拟解码统计(试次 {regulationSummary.totalTrials})</h3>
              <div className={styles.summaryMeans}>
                <span>观看时接近度 {regulationSummary.baselineMean.toFixed(2)}</span>
                <span>调控后接近度 {regulationSummary.regulationMean.toFixed(2)}</span>
                <span>
                  学习指数 L1
                  {' '}
                  {regulationSummary.deltaMean >= 0 ? '+' : ''}
                  {regulationSummary.deltaMean.toFixed(2)}
                </span>
                <span>改善试次 {regulationSummary.improvedTrials} / {regulationSummary.totalTrials}</span>
              </div>
              <p className={styles.sectionHint}>
                R = 调控段目标接近度 − 观看段接近度;正值表示调控向目标状态移动。
              </p>
            </div>
          ) : null}

          {summary.warnings.length > 0 ? (
            <ul className={styles.summaryWarnings}>
              {summary.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className={styles.sectionHint}>正在加载训练前统计…</p>
      )}

      <div className={styles.actionRow}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={onReturnToSetup}
        >
          返回设置
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => navigate('/effect-evaluation')}
        >
          前往效果评价
        </button>
      </div>
    </div>
  );
}
