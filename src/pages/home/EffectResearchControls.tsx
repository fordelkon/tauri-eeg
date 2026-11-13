import {
  EFFECT_CONDITION_OPTIONS,
  EFFECT_EMOTION_OPTIONS,
  EFFECT_METHOD_OPTIONS,
  DEFAULT_REST_MINUTES,
  DEFAULT_REGULATION_MINUTES,
} from './effectEvaluationFlow';
import { PillGroup } from './EffectResultCards';
import type { EffectPreparationDraft } from './effectPreparationHandoff';
import form from './EffectEvaluation.module.css';
import styles from './EffectSetupDisclosure.module.css';

type Props = {
  state: EffectPreparationDraft;
  onChange: (patch: Partial<EffectPreparationDraft>) => void;
  disabled: boolean;
};

export function EffectResearchControls({ state, onChange, disabled }: Props) {
  return (
    <fieldset className={styles.fields} disabled={disabled} aria-label="本次效果评价">
      <details className={styles.disclosure}>
        <summary>
          研究者配置<span>按需调整</span>
        </summary>
        <div className={styles.content}>
          <p className={form.noteCallout}>开始播放后，本次评价的方案和时长锁定。</p>
          <PillGroup
            label="测量方案:"
            options={[
              { value: 'brief', label: '简版 · 前后各 3 题' },
              { value: 'full', label: '完整量表' },
            ]}
            selectedValue={state.protocol}
            onSelect={(protocol) => onChange({ protocol })}
          />
          {state.protocol === 'full' && (
            <p className={form.noteCallout}>前测 43 题，后测 40 题（音乐调控为 49 题）。</p>
          )}
          <label className={form.fieldLabel}>
            <span className={form.fieldLabelText}>条件时长（分钟）</span>
            <select
              className={form.selectInput}
              value={state.durationMinutes}
              onChange={(event) => onChange({ durationMinutes: Number(event.currentTarget.value) })}
            >
              {[1, 3, 5, 10, 15, 30].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes}
                </option>
              ))}
            </select>
          </label>
          <PillGroup
            label="目标情绪:"
            options={[...EFFECT_EMOTION_OPTIONS]}
            selectedValue={state.emotion}
            onSelect={(value) => onChange({ emotion: value })}
          />
          <div className={form.setupSection}>
            <PillGroup
              label="实验条件:"
              options={EFFECT_CONDITION_OPTIONS.map(({ value, label }) => ({ value, label }))}
              selectedValue={state.condition}
              onSelect={(value) => {
                if (value !== state.condition)
                  onChange({
                    condition: value,
                    durationMinutes:
                      value === 'natural_recovery'
                        ? DEFAULT_REST_MINUTES
                        : DEFAULT_REGULATION_MINUTES,
                  });
              }}
            />
            {state.condition === 'regulation' ? (
              <PillGroup
                label="调控手段:"
                options={EFFECT_METHOD_OPTIONS.map(({ value, label }) => ({ value, label }))}
                selectedValue={state.method}
                onSelect={(value) => onChange({ method: value })}
              />
            ) : (
              <p className={form.noteCallout} role="note">
                自然恢复条件下，参与者在规定时间内静息。
              </p>
            )}
            <p className={form.noteCallout} role="note">
              {state.protocol === 'brief'
                ? '简版分别记录愉悦度、唤醒度和控制感的前后变化，每项 1–9 分。'
                : '完整方案保留原量表计分。跨条件比较需要同一被试、同一目标情绪的完整配对记录。'}
            </p>
          </div>
        </div>
      </details>
    </fieldset>
  );
}
