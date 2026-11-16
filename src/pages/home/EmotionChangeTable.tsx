import type { EmotionChange } from '../../mentalScale/scaleRecordsApi';
import styles from './EffectEvaluation.module.css';

const names = { anxiety: '焦虑', sadness: '悲伤', fear: '恐惧' };

function changeText(change: number) {
  if (change === 0) return '持平';
  return `${change > 0 ? '上升' : '下降'} ${Math.abs(change)} 分`;
}

export function EmotionChangeTable({
  changes,
  emotion,
  condition,
}: {
  changes: EmotionChange[];
  emotion: string | null;
  condition: string | null;
}) {
  const targetDimension = emotion === 'depression' ? 'sadness' : emotion;
  const target = changes.find((row) => row.dimension === targetDimension);
  const after = condition === 'natural_recovery' ? '自然恢复后' : '调控后';
  return (
    <section aria-label="三次情绪评分">
      {target && (
        <p className={styles.noteCallout}>
          目标情绪<strong>「{names[target.dimension]}」</strong>在诱发后
          {changeText(target.inductionChange)}，{after}
          {changeText(target.conditionChange)}。
        </p>
      )}
      <div className={styles.tableFrame}>
        <table className={styles.dimensionTable}>
          <caption>每种情绪取四个词的平均分（1–7 分）</caption>
          <thead>
            <tr>
              {['情绪', '诱发前', '诱发后', after, '诱发期间变化', '条件期间变化'].map((label) => (
                <th scope="col" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {changes.map((row) => (
              <tr key={row.dimension}>
                <th scope="row">{names[row.dimension]}</th>
                <td>{row.preInduction}</td>
                <td>{row.baseline}</td>
                <td>{row.post}</td>
                <td>{changeText(row.inductionChange)}</td>
                <td>{changeText(row.conditionChange)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
