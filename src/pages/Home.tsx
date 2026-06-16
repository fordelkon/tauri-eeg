import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import MusicNoteRoundedIcon from '@mui/icons-material/MusicNoteRounded';
import NorthEastRoundedIcon from '@mui/icons-material/NorthEastRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import SportsEsportsRoundedIcon from '@mui/icons-material/SportsEsportsRounded';
import VideocamRoundedIcon from '@mui/icons-material/VideocamRounded';
import {
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
} from '@mui/material';
import { type CSSProperties, type ElementType, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import MatterScene from '../components/MatterScene';
import GlobalEegStatusPanel from '../eeg/GlobalEegStatusPanel';
import { preloadMusicServiceForUser } from '../music/musicServicePreload';
import { getStorageLocation, setStorageRoot, type StorageLocation } from '../storage/storageApi';
import styles from './Home.module.css';

type NavigationItem = {
  icon: ElementType;
  label: string;
  path: string;
};

const navigationItems: NavigationItem[] = [
  { icon: HomeRoundedIcon, label: 'Home', path: '/home' },
  { icon: GraphicEqRoundedIcon, label: 'EEG Acquisition', path: '/eeg-acquisition' },
  { icon: VideocamRoundedIcon, label: 'Video Regulation', path: '/video-regulation' },
  { icon: SportsEsportsRoundedIcon, label: 'Game Regulation', path: '/game-regulation' },
  { icon: MusicNoteRoundedIcon, label: 'Music Regulation', path: '/music-regulation' },
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
  const { currentUser, signOut } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isStorageOpen, setIsStorageOpen] = useState(false);
  const [storageLocation, setStorageLocation] = useState<StorageLocation | null>(null);
  const [storageInput, setStorageInput] = useState('');
  const [storageError, setStorageError] = useState<string | null>(null);
  const activeItem = navigationItems.find((item) => (
    item.path === '/home'
      ? location.pathname === item.path
      : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
  )) ?? navigationItems[0];
  const isWorkspaceRoute = location.pathname !== '/home';
  const isEegWorkspaceRoute = location.pathname === '/eeg-acquisition';
  const activeIndex = navigationItems.findIndex((item) => item.path === activeItem.path);
  const nextItem = navigationItems[(activeIndex + 1) % navigationItems.length];
  const nextLabel = nextItem.label.toUpperCase();

  useEffect(() => {
    void preloadMusicServiceForUser({ userId: currentUser?.id });
  }, [currentUser?.id]);

  useEffect(() => {
    let isMounted = true;

    getStorageLocation()
      .then((location) => {
        if (isMounted) {
          setStorageLocation(location);
          setStorageInput(location.root);
        }
      })
      .catch((reason: unknown) => {
        if (isMounted) {
          setStorageError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleNavClick = (item: NavigationItem) => {
    if (item.path !== location.pathname) {
      navigate(item.path);
    }

    setIsSidebarOpen(false);
  };

  const handleMenuOpen = () => {
    setIsSidebarOpen(true);
  };

  const handleNextClick = () => {
    navigate(nextItem.path);
  };

  const handleSignOut = () => {
    signOut();
    navigate('/login', { replace: true });
  };

  const handleSaveStorageRoot = async () => {
    setStorageError(null);

    try {
      const location = await setStorageRoot(storageInput);
      setStorageLocation(location);
      setStorageInput(location.root);
      setIsStorageOpen(false);
    } catch (reason) {
      setStorageError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleResetStorageRoot = async () => {
    setStorageError(null);

    try {
      const location = await setStorageRoot(null);
      setStorageLocation(location);
      setStorageInput(location.root);
    } catch (reason) {
      setStorageError(reason instanceof Error ? reason.message : String(reason));
    }
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

          <div className={styles.userFooter}>
            <div className={styles.userAvatar} aria-hidden="true">
              {currentUser?.username.charAt(0).toUpperCase() ?? 'U'}
            </div>
            <div className={styles.userMeta}>
              <span className={styles.userLabel}>Signed in</span>
              <span className={styles.userName}>{currentUser?.username ?? 'User'}</span>
            </div>
            <IconButton
              className={styles.storageButton}
              aria-label="Set storage path"
              aria-expanded={isStorageOpen}
              size="small"
              onClick={() => setIsStorageOpen((isOpen) => !isOpen)}
            >
              <FolderRoundedIcon fontSize="small" />
            </IconButton>
            <IconButton
              className={styles.signOutButton}
              aria-label="Sign out"
              size="small"
              onClick={handleSignOut}
            >
              <LogoutRoundedIcon fontSize="small" />
            </IconButton>
          </div>

          {isStorageOpen ? (
            <section className={styles.storagePanel} aria-label="Storage path settings">
              <label className={styles.storageField}>
                <span>Storage root</span>
                <input
                  value={storageInput}
                  onChange={(event) => setStorageInput(event.currentTarget.value)}
                  placeholder="D:\\ExperimentData"
                />
              </label>
              <div className={styles.storagePreview}>
                <span>{storageLocation?.root ?? 'Default app data'}</span>
                <strong>
                  {currentUser
                    ? `${currentUser.username}\\eeg_recordings | ${currentUser.username}\\music`
                    : 'username\\eeg_recordings | username\\music'}
                </strong>
              </div>
              {storageError ? <div className={styles.storageError}>{storageError}</div> : null}
              <div className={styles.storageActions}>
                <button type="button" onClick={() => void handleResetStorageRoot()}>
                  Default
                </button>
                <button type="button" onClick={() => void handleSaveStorageRoot()}>
                  Save
                </button>
              </div>
            </section>
          ) : null}
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

      <div className={styles.shell}>
        <section
          className={`${styles.content} ${styles.isVisible} ${isWorkspaceRoute ? styles.isWorkspace : ''} ${isEegWorkspaceRoute ? styles.isEegWorkspace : ''} box-border flex flex-col`}
        >
          <Outlet />

          <button
            type="button"
            className={styles.nextPageButton}
            aria-label={`Go to ${nextItem.label}`}
            onClick={handleNextClick}
          >
            <span>{nextLabel}</span>
            <NorthEastRoundedIcon className={styles.nextPageIcon} fontSize="small" aria-hidden="true" />
          </button>
        </section>

        <GlobalEegStatusPanel />
      </div>
    </main>
  );
}
