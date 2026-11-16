import type { ExperimentMode } from '../../experiment/api';
import type { ExperimentDestination } from '../../experiment/preparation';
import { sessionKinds, sessionKindShortLabels } from '../../paradigm/paradigmSessionKinds';
import type { ParadigmSessionKind } from '../../paradigm/types';
import type { EffectPreparationDraft } from './effectPreparationHandoff';
import { EffectResearchControls } from './EffectResearchControls';
import guide from './ExperimentPreparation.module.css';
import styles from './ExperimentSettings.module.css';

type Props = {
  destination: ExperimentDestination;
  onDestination: (d: ExperimentDestination) => void;
  paradigmKind: ParadigmSessionKind;
  onKind: (kind: ParadigmSessionKind) => void;
  effectDraft: EffectPreparationDraft;
  updateEffectDraft: (patch: Partial<EffectPreparationDraft>) => void;
  locked: boolean;
  mode: ExperimentMode;
  onMode: (mode: ExperimentMode) => void;
};
export default function PreparationPlan({
  destination,
  onDestination,
  paradigmKind,
  onKind,
  effectDraft,
  updateEffectDraft,
  locked,
  mode,
  onMode,
}: Props) {
  return (
    <>
      <p className={guide.introduction}>这次要运行哪个流程？选择后，最后一步会进入对应页面。</p>
      <div className={guide.choices} role="group" aria-label="实验流程">
        <button
          type="button"
          aria-pressed={destination === 'effect'}
          disabled={locked}
          className={guide.choice}
          onClick={() => onDestination('effect')}
        >
          <strong>效果评价</strong>
          <span>诱发前评分 → 观看视频 → 诱发后评分 → 调控或自然恢复 → 再次评分</span>
        </button>
        <button
          type="button"
          aria-pressed={destination === 'paradigm'}
          disabled={locked}
          className={guide.choice}
          onClick={() => onDestination('paradigm')}
        >
          <strong>逐试次范式</strong>
          <span>个人校准或独立诱发：静息 → 提示 → 视频 → SAM</span>
        </button>
      </div>
      <label className={guide.modeField}>
        被试 ID
        <input
          aria-label="被试 ID"
          autoComplete="off"
          placeholder="例如 sub-001"
          value={effectDraft.subjectId}
          disabled={locked}
          onChange={(event) => updateEffectDraft({ subjectId: event.currentTarget.value })}
        />
      </label>
      {destination === 'paradigm' && (
        <label className={guide.modeField}>
          范式类型
          <select
            aria-label="范式类型"
            value={paradigmKind}
            disabled={locked}
            onChange={(event) => {
              const kind = sessionKinds.find((item) => item === event.target.value);
              if (kind) onKind(kind);
            }}
          >
            {sessionKinds.map((kind) => (
              <option key={kind} value={kind}>
                {sessionKindShortLabels[kind]}
              </option>
            ))}
          </select>
        </label>
      )}
      {destination === 'effect' && (
        <EffectResearchControls
          state={effectDraft}
          disabled={locked}
          onChange={updateEffectDraft}
        />
      )}
      {__EXPERIMENT_DEV__ && (
        <label className={guide.modeField}>
          模式
          <select
            aria-label="模式"
            disabled={locked}
            value={mode}
            onChange={(event) => onMode(event.target.value === 'formal' ? 'formal' : 'rehearsal')}
          >
            <option value="rehearsal">排练 · 不发送硬件 Trigger</option>
            <option value="formal">正式实验 · 发送 Trigger</option>
          </select>
        </label>
      )}
      <p className={styles.muted}>
        {!__EXPERIMENT_DEV__ || mode === 'formal'
          ? '将实际发送事件到 BioSemi，开始前需要连接触发盒并确认 BDF 保存。'
          : '用于熟悉操作。保存实验日志和量表，不发送流程 Trigger。'}
      </p>
    </>
  );
}
