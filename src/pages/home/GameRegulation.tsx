import SportsEsportsRoundedIcon from '@mui/icons-material/SportsEsportsRounded';
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import { gameRegulationOptions } from '../../game/gameRegulationOptions';
import styles from './GameRegulation.module.css';

const modeIcon = {
  AR: ViewInArRoundedIcon,
  VR: VisibilityRoundedIcon,
};

export default function GameRegulation() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>游戏调控</p>
        <h1>VR 与 AR 调控</h1>
        <p>
          选择一个调控场景入口，内部游戏启动与设备联动后续接入。
        </p>
      </header>

      <section className={styles.grid} aria-label="VR 与 AR 游戏调控入口">
        {gameRegulationOptions.map((option) => {
          const Icon = modeIcon[option.mode];

          return (
            <article className={styles.card} key={option.id}>
              <div className={styles.imageFrame}>
                <img src={option.imageSrc} alt={option.title} />
                <span className={styles.modeBadge}>
                  <Icon fontSize="small" aria-hidden="true" />
                  {option.mode}
                </span>
              </div>

              <div className={styles.cardBody}>
                <h2>{option.title}</h2>
                <p>{option.description}</p>
                <button type="button" className={styles.entryButton} disabled>
                  <SportsEsportsRoundedIcon fontSize="small" aria-hidden="true" />
                  {option.buttonLabel}
                </button>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
