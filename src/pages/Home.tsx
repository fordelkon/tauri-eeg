import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import MusicNoteRoundedIcon from '@mui/icons-material/MusicNoteRounded';
import SportsEsportsRoundedIcon from '@mui/icons-material/SportsEsportsRounded';
import VideocamRoundedIcon from '@mui/icons-material/VideocamRounded';
import {
  Box,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  Typography,
} from '@mui/material';
import { type CSSProperties, type ElementType, useState } from 'react';
import MatterScene from '../components/MatterScene';
import styles from './Home.module.css';

type NavigationItem = {
  icon: ElementType;
  label: string;
};

const navigationItems: NavigationItem[] = [
  { icon: HomeRoundedIcon, label: 'Home' },
  { icon: GraphicEqRoundedIcon, label: 'EEG Acquisition' },
  { icon: VideocamRoundedIcon, label: 'Video Regulation' },
  { icon: SportsEsportsRoundedIcon, label: 'Game Regulation' },
  { icon: MusicNoteRoundedIcon, label: 'Music Regulation' },
];

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

export default function Home() {
  const [activeItem, setActiveItem] = useState(navigationItems[0].label);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isContentVisible, setIsContentVisible] = useState(true);

  const handleNavClick = (label: string) => {
    if (label === activeItem) {
      setIsContentVisible(true);
      setIsSidebarOpen(false);
      return;
    }

    setActiveItem(label);
    setIsSidebarOpen(false);
    setTimeout(() => setIsContentVisible(true), 100);
  };

  const handleMenuOpen = () => {
    setIsSidebarOpen(true);
  };

  return (
    <main className={`${styles.page} box-border flex min-h-screen overflow-hidden relative`}>
      <div className={styles.heroBloom} aria-hidden="true">
        <span className={styles.heroCore} />
      </div>

      <IconButton
        className={`${styles.mobileMenuButton} ${isSidebarOpen ? styles.isHidden : ''}`}
        aria-label="Open navigation"
        aria-controls="primary-navigation"
        aria-expanded={isSidebarOpen}
        size="small"
        onClick={handleMenuOpen}
      >
        <MenuRoundedIcon fontSize="small" />
      </IconButton>

      <button
        className={`${styles.sidebarOverlay} ${isSidebarOpen ? styles.isOpen : ''}`}
        type="button"
        aria-label="Close navigation"
        onClick={() => setIsSidebarOpen(false)}
      />

      <div className={`${styles.menuLayer} ${isSidebarOpen ? styles.isOpen : ''}`} aria-hidden={!isSidebarOpen}>
        <aside
          id="primary-navigation"
          className={`${styles.sidebar} box-border flex flex-col`}
          aria-label="Primary navigation"
        >
          <div className={`${styles.sidebarHeader} flex items-center justify-between`}>
            <div className={`${styles.logoGroup} flex items-center`}>
              <span className={styles.logoMark} aria-hidden="true" />
              <span className={styles.logoText}>EEG</span>
            </div>
            <IconButton
              className={styles.menuButton}
              aria-label="Close navigation"
              aria-expanded={isSidebarOpen}
              size="small"
              onClick={() => setIsSidebarOpen(false)}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </div>

          <List className={`${styles.navList} flex flex-col gap-8px`} disablePadding>
            {navigationItems.map((item, index) => {
              const Icon = item.icon;
              const isActive = activeItem === item.label;

              return (
                <ListItemButton
                  key={item.label}
                  className={`${styles.navItem} ${isActive ? styles.isActive : ''}`}
                  onClick={() => handleNavClick(item.label)}
                  selected={isActive}
                  style={{ '--item-index': index } as CSSProperties}
                >
                  <ListItemIcon className={styles.navIcon}>
                    <Icon fontSize="small" />
                  </ListItemIcon>
                  <span className={styles.navLabel}>{renderRollingText(item.label)}</span>
                </ListItemButton>
              );
            })}
          </List>
        </aside>

        <section className={styles.menuVisual} aria-hidden="true">
          <MatterScene className="absolute inset-0" scale={1} title={activeItem} />
        </section>
      </div>

      <section className={`${styles.content} ${isContentVisible ? styles.isVisible : ''} box-border flex flex-col`}>
        <Box key={`header-${activeItem}`} className={`${styles.contentHeader} flex flex-col`}>
            <Typography className={styles.eyebrow}>Control Center</Typography>
            <Typography variant="h3" component="h1" className={styles.title}>
              {renderRollingText(activeItem, styles.titleText)}
            </Typography>
            <Typography className={styles.description}>
              A calm workspace for EEG-driven acquisition and adaptive regulation workflows.
            </Typography>
          </Box>

        <Box key={`surface-${activeItem}`} className={`${styles.surface} box-border flex flex-col`}>
          <Typography className={styles.surfaceTitle}>Session Overview</Typography>
          <Typography className={styles.surfaceText}>
            Select a module from the sidebar to continue. The dashboard shell is ready for acquisition,
            video, game, and music regulation pages.
          </Typography>
        </Box>
      </section>
    </main>
  );
}
