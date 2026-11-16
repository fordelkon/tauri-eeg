import type { ExperimentDestination } from '../../experiment/preparation';
import type { ExperimentPreferences } from '../../experiment/settings';
import type { TriggerStatus } from '../../experiment/api';
import type { EffectPreparationDraft } from './effectPreparationHandoff';
import { EFFECT_EMOTION_OPTIONS, EFFECT_METHOD_OPTIONS } from './effectEvaluationFlow';
import type { ParadigmSessionKind } from '../../paradigm/types';
import { sessionKindShortLabels } from '../../paradigm/paradigmSessionKinds';
import styles from './ExperimentSettings.module.css';
import guide from './ExperimentPreparation.module.css';
type Props = {
  destinationLabel: string;
  destination: ExperimentDestination;
  paradigmKind: ParadigmSessionKind;
  effectDraft: EffectPreparationDraft;
  formal: boolean;
  status: TriggerStatus;
  validatedLibrary: string;
  library: string;
  confirmed: boolean;
  preferences: ExperimentPreferences;
  canEnter: boolean;
  subjectMissing: boolean;
  readiness: { blockers: string[] };
  goToStep: (step: number) => void;
};
export default function PreparationReview({
  destinationLabel,
  destination,
  paradigmKind,
  effectDraft,
  formal,
  status,
  validatedLibrary,
  library,
  confirmed,
  preferences,
  canEnter,
  subjectMissing,
  readiness,
  goToStep,
}: Props) {
  return (
    <>
      <p className={guide.introduction}>
        即将进入的是 <strong>{destinationLabel}</strong>
        。请核对，避免把个人校准当作效果评价。
      </p>
      <dl className={guide.review}>
        <div>
          <dt>被试 ID</dt>
          <dd>{effectDraft.subjectId.trim() || '尚未填写'}</dd>
        </div>
        {destination === 'effect' && (
          <>
            <div>
              <dt>目标与条件</dt>
              <dd>
                {
                  EFFECT_EMOTION_OPTIONS.find((option) => option.value === effectDraft.emotion)
                    ?.label
                }{' '}
                ·{' '}
                {effectDraft.condition === 'natural_recovery'
                  ? '自然恢复'
                  : EFFECT_METHOD_OPTIONS.find(({ value }) => value === effectDraft.method)?.label}
              </dd>
            </div>
            <div>
              <dt>测量方案</dt>
              <dd>状态情绪评分 · 三次各 12 项 · {effectDraft.durationMinutes} 分钟</dd>
            </div>
          </>
        )}
        <div>
          <dt>实验流程</dt>
          <dd>
            {destination === 'paradigm' ? sessionKindShortLabels[paradigmKind] : destinationLabel}
          </dd>
        </div>
        <div>
          <dt>运行模式</dt>
          <dd>{formal ? '正式实验 · 发送 Trigger' : '排练 · 不发送流程标记'}</dd>
        </div>
        <div>
          <dt>触发盒</dt>
          <dd>
            {status.connected
              ? `已连接 · ${status.portName}${status.tested ? ' · 测试通过' : ' · 未测试'}`
              : formal
                ? '尚未连接'
                : '排练无需连接'}
          </dd>
        </div>
        <div>
          <dt>视频素材</dt>
          <dd>{validatedLibrary === library.trim() && validatedLibrary ? '已验证' : '需要验证'}</dd>
        </div>
        <div>
          <dt>BDF 保存</dt>
          <dd>
            {formal
              ? confirmed
                ? `操作者已确认 · ${preferences.expectedRecordingName || '未填写记录名'}`
                : '尚未确认'
              : '排练无需保存'}
          </dd>
        </div>
      </dl>
      {!canEnter && (
        <div className={guide.blockers} role="status">
          <strong>还需要完成</strong>
          <ul>
            {subjectMissing && (
              <li>
                <button type="button" className={styles.ghostButton} onClick={() => goToStep(0)}>
                  返回第一步填写被试 ID
                </button>
              </li>
            )}
            {readiness.blockers.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <p className={styles.muted}>
        {destination === 'effect'
          ? '进入后请将界面交给参与者，先填写观看视频前的感受。'
          : '进入后核对素材并开始，才创建实验记录。'}
      </p>
    </>
  );
}
