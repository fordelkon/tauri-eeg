import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import MusicNoteRoundedIcon from '@mui/icons-material/MusicNoteRounded';
import SportsEsportsRoundedIcon from '@mui/icons-material/SportsEsportsRounded';
import VideocamRoundedIcon from '@mui/icons-material/VideocamRounded';
import {
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
} from '@mui/material';
import { type CSSProperties, type ElementType, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import MatterScene from '../components/MatterScene';
import styles from './Home.module.css';

type NavigationItem = {
  icon: ElementType;
  label: string;
  path: string;
};

const navigationItems: NavigationItem[] = [
  { icon: HomeRoundedIcon, label: 'Home', path: '/home' },
  { icon: GraphicEqRoundedIcon, label: 'EEG Acquisition', path: '/home/eeg-acquisition' },
  { icon: VideocamRoundedIcon, label: 'Video Regulation', path: '/home/video-regulation' },
  { icon: SportsEsportsRoundedIcon, label: 'Game Regulation', path: '/home/game-regulation' },
  { icon: MusicNoteRoundedIcon, label: 'Music Regulation', path: '/home/music-regulation' },
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
  const location = useLocation();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const activeItem = navigationItems.find((item) => item.path === location.pathname) ?? navigationItems[0];

  const handleNavClick = (item: NavigationItem) => {
    if (item.path !== location.pathname) {
      navigate(item.path);
    }

    setIsSidebarOpen(false);
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
              const isActive = activeItem.path === item.path;

              return (
                <ListItemButton
                  key={item.label}
                  className={`${styles.navItem} ${isActive ? styles.isActive : ''}`}
                  onClick={() => handleNavClick(item)}
                  selected={isActive}
                  style={{ '--item-index': index } as CSSProperties}
                  aria-current={isActive ? 'page' : undefined}
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
          <MatterScene
            className="absolute inset-0"
            initialBallCount={10}
            maxBallCount={18}
            scale={1}
            title={activeItem.label}
          />
        </section>
      </div>

      <section key={location.pathname} className={`${styles.content} ${styles.isVisible} box-border flex flex-col`}>
        <Outlet />
      </section>
    </main>
  );
}
