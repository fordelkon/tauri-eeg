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
import { Drawer, useMediaQuery } from '@mui/material';
import {
  type ElementType,
  type MouseEvent,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import ExperimentAgentPanel from '../agent/ExperimentAgentPanel';
import { useAuth } from '../auth/AuthContext';
import { getTriggerStatus } from '../experiment/api';
import { isTauriAvailable } from '../ui/tauriEnvironment';
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
import {
  isScaleSatisfiedForPath,
  recordScaleCompletion,
  recordScaleSkip,
} from '../mentalScale/scaleCompletion';
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
  { icon: InsightsRoundedIcon, label: '效果评价', path: '/effect-evaluation' },
  { icon: VideocamRoundedIcon, label: '视频调控', path: '/video-regulation' },
  { icon: SportsEsportsRoundedIcon, label: 'VR调控', path: '/game-regulation' },
  { icon: MusicNoteRoundedIcon, label: '音乐调控', path: '/music-regulation' },
];

export default function Home() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, signOut } = useAuth();
  const paradigmStatus = useParadigmSessionStatus();
  const { confirm, confirmDialogElement } = useConfirmDialog();
  const wideWindow = useMediaQuery('(min-width: 981px)');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isStorageOpen, setIsStorageOpen] = useState(false);
  const [pendingScale, setPendingScale] = useState<MentalScaleDefinition | null>(null);
  const [showHomeIntro, setShowHomeIntro] = useState(false);
  const activeItem =
    navigationItems.find((item) =>
      item.path === '/home'
        ? location.pathname === item.path
        : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`),
    ) ?? navigationItems[0];
  const isWorkspaceRoute = location.pathname !== '/home';
  const isIndependentActivity = [
    '/video-regulation',
    '/game-regulation',
    '/music-regulation',
  ].includes(activeItem.path);

  useEffect(() => {
    if (homeIntroPlayback.shouldPlay(currentUser?.id)) {
      setShowHomeIntro(true);
    }
  }, [currentUser?.id]);

  const requestNavigation = useCallback(
    async (path: string) => {
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
            await confirm({
              title: '实验进行中',
              description: '请先完成或中止当前实验，再切换页面。',
              confirmText: '知道了',
              hideCancel: true,
            });
            return;
          }
        } catch {
          await confirm({
            title: '无法确认实验状态',
            description: '请重试，避免中断正在进行的刺激。',
            confirmText: '知道了',
            hideCancel: true,
          });
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
    },
    [confirm, location.pathname, navigate],
  );

  const handleNavClick = (item: NavigationItem) => {
    void requestNavigation(item.path);
    setIsSidebarOpen(false);
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
      window.dispatchEvent(
        new CustomEvent('agent:record-action', {
          detail: { actionId, payload },
        }),
      );
    }
  };

  const handleSignOut = async () => {
    if (isTauriAvailable()) {
      try {
        if ((await getTriggerStatus()).activeRunId) {
          await confirm({
            title: '实验进行中',
            description: '请先完成或中止当前实验，再退出登录。',
            confirmText: '知道了',
            hideCancel: true,
          });
          return;
        }
      } catch {
        await confirm({
          title: '无法确认实验状态',
          description: '请重试后再退出登录。',
          confirmText: '知道了',
          hideCancel: true,
        });
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

  const navigation = (
    <>
      <div className={styles.brandRow}>
        <img src="/logo.svg" alt="" width="27" height="27" />
        <strong>EEG</strong>
        {!wideWindow && (
          <button
            className={styles.iconButton}
            aria-label="关闭导航"
            onClick={() => setIsSidebarOpen(false)}
          >
            <CloseRoundedIcon fontSize="small" />
          </button>
        )}
      </div>
      <div className={styles.railNav}>
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const active = activeItem.path === item.path;
          return (
            <button
              key={item.path}
              type="button"
              className={styles.navItem}
              aria-current={active ? 'page' : undefined}
              title={item.label}
              aria-label={item.label}
              onClick={() => handleNavClick(item)}
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
          className={styles.navItem}
          title="存储路径设置"
          aria-label="存储路径设置"
          aria-haspopup="dialog"
          disabled={paradigmStatus.active}
          onClick={() => setIsStorageOpen(true)}
        >
          <FolderRoundedIcon fontSize="small" />
          <span>存储路径设置</span>
        </button>
        <div className={styles.accountRow}>
          <span className={styles.userAvatar} aria-hidden="true">
            {currentUser?.username.charAt(0).toUpperCase() ?? 'U'}
          </span>
          <div className={styles.userMeta}>
            <span>已登录</span>
            <strong title={currentUser?.username}>{currentUser?.username ?? '用户'}</strong>
          </div>
          <button
            className={styles.iconButton}
            title="退出登录"
            aria-label="退出登录"
            disabled={paradigmStatus.active}
            onClick={() => void handleSignOut()}
          >
            <LogoutRoundedIcon fontSize="small" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <main className={styles.page} onClick={handleAgentActionClick}>
      {wideWindow ? (
        <nav className={styles.desktopRail} aria-label="主导航">
          {navigation}
        </nav>
      ) : (
        <>
          <button
            type="button"
            className={styles.mobileMenuButton}
            aria-label="打开导航"
            aria-expanded={isSidebarOpen}
            aria-controls={isSidebarOpen ? 'primary-navigation' : undefined}
            onClick={() => setIsSidebarOpen(true)}
          >
            <MenuRoundedIcon fontSize="small" />
            <span>{activeItem.label}</span>
          </button>
          <Drawer
            open={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            transitionDuration={reducedMotion ? 0 : 180}
            slotProps={{ paper: { className: styles.drawerPaper, 'aria-label': '导航菜单' } }}
          >
            <nav id="primary-navigation" className={styles.drawerNav} aria-label="主导航">
              {navigation}
            </nav>
          </Drawer>
        </>
      )}
      {isStorageOpen && (
        <StorageSettingsPanel
          onClose={() => setIsStorageOpen(false)}
          username={currentUser?.username}
        />
      )}

      <div className={styles.shell}>
        <section
          id="workspace-content"
          className={`${styles.content} ${isWorkspaceRoute ? styles.isWorkspace : ''} box-border flex flex-col`}
        >
          <Outlet context={{ requestNavigation }} />

          {isIndependentActivity ? (
            <button
              type="button"
              className={styles.nextPageButton}
              aria-label="返回首页"
              onClick={() => void requestNavigation('/home')}
            >
              <span>返回首页</span>
              <NorthEastRoundedIcon fontSize="small" aria-hidden="true" />
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
