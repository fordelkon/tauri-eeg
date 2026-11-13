import type { StateRatingChange } from '../../mentalScale/scaleRecordsApi';
import styles from './EffectEvaluation.module.css';

const labels = { valence: '愉悦度', arousal: '唤醒度', dominance: '控制感' };

export function StateRatingTable({ changes }: { changes: StateRatingChange[] }) {
  return (
    <div className={styles.tableFrame}>
      <table className={styles.dimensionTable}>
        <caption>两次感受记录（1–9 分）</caption>
        <thead>
          <tr>
            {['维度', '体验前', '体验后', '变化（后减前）'].map((label) => (
              <th scope="col" key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {changes.map(({ dimension, baseline, post, change }) => (
            <tr key={dimension}>
              <th scope="row">{labels[dimension]}</th>
              <td>{baseline}</td>
              <td>{post}</td>
              <td>
                {change > 0 ? '+' : ''}
                {change}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
