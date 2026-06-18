import { Box } from '@mui/material';
import LottieEegLogo from '../../homeIntro/LottieEegLogo';
import styles from '../Home.module.css';

export default function HomeOverview() {
  return (
    <Box className={styles.homeLogoCenter} aria-label="EEG emotion regulation home logo">
      <LottieEegLogo className={styles.homeLogoMark} />
    </Box>
  );
}
