import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import MusicNoteRoundedIcon from '@mui/icons-material/MusicNoteRounded';
import PlayCircleOutlineRoundedIcon from '@mui/icons-material/PlayCircleOutlineRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { useOutletContext } from 'react-router-dom';
import styles from './HomeOverview.module.css';

type OverviewContext = {
  requestNavigation: (path: string) => Promise<void>;
};

export default function HomeOverview() {
  const { requestNavigation } = useOutletContext<OverviewContext>();

  return (
    <section className={styles.overview} aria-labelledby="overview-title">
      <header className={styles.header}>
        <span className={styles.wordmark}>
          <GraphicEqRoundedIcon aria-label="脑电情绪调节首页标志" />
          实验工作台
        </span>
        <h1 id="overview-title">情绪调控实验</h1>
        <p>从准备设备到记录前后测，在这里开始或继续本次实验。</p>
      </header>
      <div className={styles.workspace}>
        <button
          type="button"
          className={styles.featuredAction}
          onClick={() => void requestNavigation('/experiment-settings')}
        >
          <span className={styles.featuredIcon}>
            <TuneRoundedIcon />
          </span>
          <span className={styles.actionCopy}>
            <strong>开始实验设置</strong>
            <span>确认被试编号、连接设备、选择实验素材</span>
          </span>
          <ArrowForwardRoundedIcon className={styles.arrow} />
        </button>
        <button
          type="button"
          className={styles.secondaryAction}
          onClick={() => void requestNavigation('/effect-evaluation')}
        >
          <InsightsRoundedIcon className={styles.rowIcon} />
          <span className={styles.actionCopy}>
            <strong>效果评价</strong>
            <span>继续当前评价，或查看已完成的记录</span>
          </span>
          <ArrowForwardRoundedIcon className={styles.arrow} />
        </button>
      </div>
      <footer className={styles.footer}>
        <p>独立体验</p>
        <button
          type="button"
          className={styles.evaluationLink}
          onClick={() => void requestNavigation('/music-regulation')}
        >
          <MusicNoteRoundedIcon fontSize="small" />
          听音乐
        </button>
        <button
          type="button"
          className={styles.evaluationLink}
          onClick={() => void requestNavigation('/video-regulation')}
        >
          <PlayCircleOutlineRoundedIcon fontSize="small" />
          看影像
        </button>
      </footer>
    </section>
  );
}
