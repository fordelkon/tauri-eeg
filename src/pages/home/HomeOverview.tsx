import { Box } from '@mui/material';
import LottieEegLogo from '../../homeIntro/LottieEegLogo';
import styles from '../Home.module.css';

export default function HomeOverview() {
  return (
    <Box className={styles.homeLogoCenter} aria-label="脑电情绪调节首页标志">
      <LottieEegLogo className={styles.homeLogoMark} />
    </Box>
  );
}
