import Button from '@mui/material/Button';
import { useNavigate } from 'react-router-dom';
import styles from './EffectEvaluation.module.css';
export default function EffectDeviceQuickStart() {
  const navigate = useNavigate();
  return <><span className={styles.configChip}>BioSemi 外部 BDF 记录</span><Button size="small" variant="outlined" onClick={() => navigate('/experiment-settings')}>Trigger 与实验设置</Button></>;
}
