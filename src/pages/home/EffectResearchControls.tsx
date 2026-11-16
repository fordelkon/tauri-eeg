import { useId } from 'react';
import {
  EFFECT_CONDITION_OPTIONS,
  EFFECT_EMOTION_OPTIONS,
  EFFECT_METHOD_OPTIONS,
  DEFAULT_REST_MINUTES,
  DEFAULT_REGULATION_MINUTES,
} from './effectEvaluationFlow';
import type { EffectPreparationDraft } from './effectPreparationHandoff';
import form from './EffectEvaluation.module.css';
import styles from './EffectSetupDisclosure.module.css';

type Props = {
  state: EffectPreparationDraft;
  onChange: (patch: Partial<EffectPreparationDraft>) => void;
  disabled: boolean;
};

function OptionGroup<T extends string>({
  label,
  options,
  selectedValue,
  onSelect,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  selectedValue: T;
  onSelect: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className={styles.optionGroup}>
      <legend>{label}</legend>
      <div className={styles.options}>
        {options.map((option) => (
          <label key={option.value} className={styles.option}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selectedValue === option.value}
              onChange={() => onSelect(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function EffectResearchControls({ state, onChange, disabled }: Props) {
  const conditionLabel =
    state.condition === 'natural_recovery'
      ? '自然恢复'
      : EFFECT_METHOD_OPTIONS.find(({ value }) => value === state.method)?.label;
  return (
    <fieldset className={styles.fields} disabled={disabled} aria-label="本次效果评价">
      <details className={styles.disclosure}>
        <summary>
          研究者配置
          <span>
            {EFFECT_EMOTION_OPTIONS.find((option) => option.value === state.emotion)?.label} ·{' '}
            {conditionLabel} · {state.durationMinutes} 分钟
          </span>
        </summary>
        <div className={styles.content}>
          <p className={form.noteCallout}>
            诱发前、诱发后和条件结束时填写相同的 12 个情绪词，分别记录焦虑、悲伤和恐惧。题目采用 DEQ
            三个分量表的中文研究译稿。
          </p>
          <label className={form.fieldLabel}>
            <span className={form.fieldLabelText}>条件时长（分钟）</span>
            <select
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
          <OptionGroup
            label="目标情绪"
            options={EFFECT_EMOTION_OPTIONS}
            selectedValue={state.emotion}
            onSelect={(value) => onChange({ emotion: value })}
          />
          <div className={form.setupSection}>
            <OptionGroup
              label="实验条件"
              options={EFFECT_CONDITION_OPTIONS}
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
              <OptionGroup
                label="调控手段"
                options={EFFECT_METHOD_OPTIONS}
                selectedValue={state.method}
                onSelect={(value) => onChange({ method: value })}
              />
            ) : (
              <p className={form.noteCallout} role="note">
                自然恢复条件下，参与者在规定时间内静息。
              </p>
            )}
          </div>
        </div>
      </details>
    </fieldset>
  );
}
