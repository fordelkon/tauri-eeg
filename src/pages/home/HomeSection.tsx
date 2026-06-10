import { Box, Typography } from '@mui/material';
import { type CSSProperties } from 'react';
import styles from '../Home.module.css';

type Props = {
  description: string;
  eyebrow?: string;
  surfaceText: string;
  surfaceTitle?: string;
  title: string;
};

const renderRollingText = (text: string, className?: string) => (
  <span className={`${styles.rollingText} ${className ?? ''}`} aria-label={text}>
    {[...text].map((letter, index) => (
      <span
        key={`${letter}-${index}`}
        aria-hidden="true"
        style={{ '--letter-index': index } as CSSProperties}
      >
        {letter === ' ' ? '\u00a0' : letter}
      </span>
    ))}
  </span>
);

export default function HomeSection({
  description,
  eyebrow = 'Control Center',
  surfaceText,
  surfaceTitle = 'Session Overview',
  title,
}: Props) {
  return (
    <>
      <Box className={`${styles.contentHeader} flex flex-col`}>
        <Typography className={styles.eyebrow}>{eyebrow}</Typography>
        <Typography variant="h3" component="h1" className={styles.title}>
          {renderRollingText(title, styles.titleText)}
        </Typography>
        <Typography className={styles.description}>{description}</Typography>
      </Box>

      <Box className={`${styles.surface} box-border flex flex-col`}>
        <Typography className={styles.surfaceTitle}>{surfaceTitle}</Typography>
        <Typography className={styles.surfaceText}>{surfaceText}</Typography>
      </Box>
    </>
  );
}
