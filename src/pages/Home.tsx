import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
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
import { type CSSProperties, type ElementType, type MouseEvent, Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import ExperimentAgentPanel from '../agent/ExperimentAgentPanel';
import { useAuth } from '../auth/AuthContext';
import { getTriggerStatus } from '../experiment/api';
import { isTauriAvailable } from '../ui/tauriEnvironment';
// Lazy: MatterScene pulls in the matter-js vendor chunk and HomeIntroLogo the
// lottie player; neither is needed until the menu opens or the intro plays.
const MatterScene = lazy(() => import('../components/MatterScene'));
const HomeIntroLogo = lazy(() => import('../homeIntro/HomeIntroLogo'));
import { homeIntroPlayback } from '../homeIntro/homeIntroPlayback';
import GlobalMentalScalePanel from '../mentalScale/GlobalMentalScalePanel';
import MentalScaleDialog from '../mentalScale/MentalScaleDialog';
import {
  getMentalScaleForPath,
  type MentalScaleAnswers,
  type MentalScaleDefinition,
} from '../mentalScale/mentalScaleGate';
import { buildMentalScaleStatus, updateMentalScaleStatus } from '../mentalScale/mentalScaleStatus';
import { persistMentalScaleSubmission } from '../mentalScale/scaleRecordsApi';
import { isScaleSatisfiedForPath, recordScaleCompletion, recordScaleSkip } from '../mentalScale/scaleCompletion';
import {
  getParadigmSessionStatus,
  useParadigmSessionStatus,
} from '../paradigm/paradigmSessionStatus';
import { useConfirmDialog } from '../ui/useConfirmDialog';
import StorageSettingsPanel from './StorageSettingsPanel';
import styles from './Home.module.css';

type NavigationItem = {
  icon: ElementType;
  label: string;
  path: string;
};

const navigationItems: NavigationItem[] = [
  { icon: HomeRoundedIcon, label: '首页', path: '/home' },
  { icon: GraphicEqRoundedIcon, label: '实验设置', path: '/experiment-settings' },
  { icon: VideocamRoundedIcon, label: '视频调控', path: '/video-regulation' },
  { icon: SportsEsportsRoundedIcon, label: 'VR调控', path: '/game-regulation' },
  { icon: MusicNoteRoundedIcon, label: '音乐调控', path: '/music-regulation' },
  { icon: InsightsRoundedIcon, label: '效果评价', path: '/effect-evaluation' },
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
  const paradigmStatus = useParadigmSessionStatus();
  const { confirm, confirmDialogElement } = useConfirmDialog();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isStorageOpen, setIsStorageOpen] = useState(false);
  const [pendingScale, setPendingScale] = useState<MentalScaleDefinition | null>(null);
  const [showHomeIntro, setShowHomeIntro] = useState(false);
  const activeItem = navigationItems.find((item) => (
    item.path === '/home'
      ? location.pathname === item.path
      : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
  )) ?? navigationItems[0];
  const isWorkspaceRoute = location.pathname !== '/home';
  const activeIndex = navigationItems.findIndex((item) => item.path === activeItem.path);
  const nextItem = navigationItems[(activeIndex + 1) % navigationItems.length];
  const nextLabel = nextItem.label.toUpperCase();

  useEffect(() => {
    if (homeIntroPlayback.shouldPlay(currentUser?.id)) {
      setShowHomeIntro(true);
    }
  }, [currentUser?.id]);

  const requestNavigation = useCallback(async (path: string) => {
    if (path === location.pathname) {
      return;
    }

    // A live paradigm session owns the EEG recording; leaving the page would
    // break the trial timeline. Read the module store directly: the check is
    // click-time only and does not need a subscription.
    if (getParadigmSessionStatus().active) {
      await confirm({
        title: '范式 Session 进行中',
        description: '请先结束当前范式 Session,再切换页面。',
        confirmText: '知道了',
        hideCancel: true,
      });
      return;
    }

    if (isTauriAvailable()) {
      try {
        if ((await getTriggerStatus()).activeRunId) {
          await confirm({ title: '实验进行中', description: '请先完成或中止当前实验，再切换页面。', confirmText: '知道了', hideCancel: true });
          return;
        }
      } catch {
        await confirm({ title: '无法确认实验状态', description: '请重试，避免中断正在进行的刺激。', confirmText: '知道了', hideCancel: true });
        return;
      }
    }

    const scale = getMentalScaleForPath(path);

    // The route-level ScaleGateRoute would also catch this, but prompting from
    // here keeps the sidebar flow identical — and skips re-prompting while a
    // recent completion is still inside its grace window.
    if (scale && !isScaleSatisfiedForPath(scale.path)) {
      setPendingScale(scale);
      setIsSidebarOpen(false);
      return;
    }

    navigate(path);
  }, [confirm, location.pathname, navigate]);

  const handleNavClick = (item: NavigationItem) => {
    requestNavigation(item.path);
    setIsSidebarOpen(false);
  };

  const handleMenuOpen = () => {
    setIsSidebarOpen(true);
  };

  const handleNextClick = () => {
    requestNavigation(nextItem.path);
  };

  const handleAgentActionClick = (event: MouseEvent<HTMLElement>) => {
    const actionElement = (event.target as HTMLElement).closest<HTMLElement>('[data-agent-action]');
    const actionId = actionElement?.dataset.agentAction;
    const payload = actionElement?.dataset.agentPayload;

    // These page buttons already run their own behavior; the agent only gets
    // a timeline record for later planning context. Submitting the synthetic
    // id as a prompt used to burn a planner round on a string the local
    // classifier cannot match and risk a second playback/generation.
    if (actionId === 'play_video' || actionId === 'generate_music') {
      window.dispatchEvent(new CustomEvent('agent:record-action', {
        detail: { actionId, payload },
      }));
    }
  };

  const handleSignOut = async () => {
    if (isTauriAvailable()) {
      try {
        if ((await getTriggerStatus()).activeRunId) {
          await confirm({ title: '实验进行中', description: '请先完成或中止当前实验，再退出登录。', confirmText: '知道了', hideCancel: true });
          return;
        }
      } catch {
        await confirm({ title: '无法确认实验状态', description: '请重试后再退出登录。', confirmText: '知道了', hideCancel: true });
        return;
      }
    }

    signOut();
    navigate('/login', { replace: true });
  };

  const handleCloseScale = () => {
    setPendingScale(null);
  };

  const handleCompleteScale = (answers: MentalScaleAnswers) => {
    if (!pendingScale) {
      return;
    }

    const nextPath = pendingScale.path;
    updateMentalScaleStatus(buildMentalScaleStatus(pendingScale, answers));
    recordScaleCompletion(nextPath);
    // Mirror the submission into the backend scale_records table; a failure
    // only logs so the gate flow keeps working offline.
    persistMentalScaleSubmission(pendingScale, answers, currentUser?.id ?? null);
    setPendingScale(null);
    navigate(nextPath);
  };

  const handleSkipScale = () => {
    if (!pendingScale) {
      return;
    }

    const nextPath = pendingScale.path;
    // Skipping is a one-shot pass: the next entry into a gated page re-prompts.
    recordScaleSkip(nextPath);
    setPendingScale(null);
    navigate(nextPath);
  };

  return (
    <main
      className={`${styles.page} box-border flex min-h-screen overflow-hidden relative`}
      onClick={handleAgentActionClick}
    >
      {/* The 760px coral hero disc is the /home brand stage; on monitor
          pages it reads as a stain behind dense UI, so it stays home-only. */}
      {activeItem.path === '/home' ? (
        <div className={styles.heroBloom} aria-hidden="true">
          <span className={styles.heroCore} />
        </div>
      ) : null}

      <IconButton
        className={`${styles.mobileMenuButton} ${isSidebarOpen ? styles.isHidden : ''}`}
        aria-label="打开导航"
        aria-controls="primary-navigation"
        aria-expanded={isSidebarOpen}
        aria-hidden={isSidebarOpen}
        size="small"
        tabIndex={isSidebarOpen ? -1 : 0}
        onClick={handleMenuOpen}
      >
        <MenuRoundedIcon fontSize="small" />
      </IconButton>

      {/* Persistent desktop rail: one-click navigation on wide screens. The
          hamburger + overlay menu remains the narrow-screen flow. */}
      <nav className={styles.desktopRail} aria-label="主导航">
        <span className={`${styles.logoMark} ${styles.railLogo}`} aria-hidden="true" />
        <div className={styles.railNav}>
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeItem.path === item.path;

            return (
              <button
                key={item.label}
                type="button"
                className={`${styles.railItem} ${isActive ? styles.isRailActive : ''}`}
                aria-current={isActive ? 'page' : undefined}
                title={item.label}
                onClick={() => void requestNavigation(item.path)}
              >
                <Icon fontSize="small" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
        <div className={styles.railFooter}>
          <button
            type="button"
            className={styles.railSignOut}
            title={paradigmStatus.active ? '范式 Session 进行中,无法退出登录' : '退出登录'}
            aria-label="退出登录"
            disabled={paradigmStatus.active}
            onClick={() => void handleSignOut()}
          >
            <LogoutRoundedIcon fontSize="small" />
          </button>
        </div>
      </nav>

      <button
        className={`${styles.sidebarOverlay} ${isSidebarOpen ? styles.isOpen : ''}`}
        type="button"
        aria-label="关闭导航"
        aria-hidden={!isSidebarOpen}
        tabIndex={isSidebarOpen ? 0 : -1}
        onClick={() => setIsSidebarOpen(false)}
      />

      <div className={`${styles.menuLayer} ${isSidebarOpen ? styles.isOpen : ''}`} aria-hidden={!isSidebarOpen}>
        <aside
          id="primary-navigation"
          className={`${styles.sidebar} box-border flex flex-col`}
          aria-label="主导航"
        >
          <div className={`${styles.sidebarHeader} flex items-center justify-between`}>
            <div className={`${styles.logoGroup} flex items-center`}>
              <span className={styles.logoMark} aria-hidden="true" />
              <span className={styles.logoText}>EEG</span>
            </div>
            <IconButton
              className={styles.menuButton}
              aria-label="关闭导航"
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
              <span className={styles.userLabel}>已登录</span>
              <span className={styles.userName}>{currentUser?.username ?? '用户'}</span>
            </div>
            <IconButton
              className={styles.storageButton}
              aria-label="存储路径设置"
              aria-expanded={isStorageOpen}
              size="small"
              disabled={paradigmStatus.active}
              onClick={() => setIsStorageOpen((isOpen) => !isOpen)}
            >
              <FolderRoundedIcon fontSize="small" />
            </IconButton>
            <IconButton
              className={styles.signOutButton}
              aria-label="退出登录"
              size="small"
              disabled={paradigmStatus.active}
              onClick={handleSignOut}
            >
              <LogoutRoundedIcon fontSize="small" />
            </IconButton>
          </div>

          {isStorageOpen ? (
            <StorageSettingsPanel
              onClose={() => setIsStorageOpen(false)}
              username={currentUser?.username}
            />
          ) : null}
        </aside>

        <section className={styles.menuVisual} aria-hidden="true">
          {isSidebarOpen ? (
            <Suspense fallback={null}>
              <MatterScene
                className="absolute inset-0"
                initialBallCount={10}
                maxBallCount={18}
                scale={1}
                title={activeItem.label}
              />
            </Suspense>
          ) : null}
        </section>
      </div>

      <div className={styles.shell}>
        <section
          id="workspace-content"
          className={`${styles.content} ${styles.isVisible} ${isWorkspaceRoute ? styles.isWorkspace : ''} box-border flex flex-col`}
        >
          <Outlet />

          {location.pathname !== '/experiment-settings' ? (
            <button
              type="button"
              className={styles.nextPageButton}
              aria-label={`前往${nextItem.label}`}
              onClick={handleNextClick}
            >
              <span>{nextLabel}</span>
              <NorthEastRoundedIcon className={styles.nextPageIcon} fontSize="small" aria-hidden="true" />
            </button>
          ) : null}
        </section>

        <GlobalMentalScalePanel>
          <ExperimentAgentPanel navigateTo={requestNavigation} />
        </GlobalMentalScalePanel>
      </div>

      {pendingScale ? (
        <MentalScaleDialog
          key={pendingScale.path}
          onComplete={handleCompleteScale}
          onClose={handleCloseScale}
          onSkip={handleSkipScale}
          scale={pendingScale}
        />
      ) : null}

      {confirmDialogElement}

      {showHomeIntro ? (
        <Suspense fallback={null}>
          <HomeIntroLogo onComplete={() => setShowHomeIntro(false)} />
        </Suspense>
      ) : null}
    </main>
  );
}
