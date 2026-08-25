import LockRoundedIcon from '@mui/icons-material/LockRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import {
  Box,
  Button,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import type { MatterBackground } from '../components/matterBackground';
import styles from './Login.module.css';

const translateAuthError = (error: unknown) => {
  if (typeof error !== 'string') {
    return '账号或密码不正确。';
  }

  const translations: Record<string, string> = {
    'Account or password is incorrect.': '账号或密码不正确。',
    'Failed to register user.': '注册失败，请稍后重试。',
    'Failed to reset password.': '重置密码失败，请稍后重试。',
    'Password must be at least 6 characters.': '密码至少需要 6 位。',
    'Password reset is not configured.': '暂未配置密码重置功能。',
    'Reset code is incorrect.': '重置码不正确。',
    'Username and password are required.': '请输入账号和密码。',
    'Username is already registered.': '该账号已被注册。',
  };

  return translations[error] ?? error;
};

export default function Login() {
  const navigate = useNavigate();
  const { resetPassword, signIn, signUp } = useAuth();
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const matterHostRef = useRef<HTMLDivElement>(null);
  const pointerTargetRef = useRef<{ active: boolean; x: number; y: number }>({
    active: false,
    x: 0.5,
    y: 0.5,
  });
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [hasError, setHasError] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [errorMessage, setErrorMessage] = useState('');
  // Reset success is a persistent notice (green), not an error: it stays until
  // the user starts typing again instead of vanishing on a timer.
  const [successMessage, setSuccessMessage] = useState('');
  const [isExiting, setIsExiting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [exitStyle, setExitStyle] = useState<CSSProperties>({});
  const exitTimeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (exitTimeoutRef.current !== null) {
      window.clearTimeout(exitTimeoutRef.current);
    }
  }, []);

  const isSignup = authMode === 'signup';
  const isReset = authMode === 'reset';

  useEffect(() => {
    const host = matterHostRef.current;

    if (!host) {
      return undefined;
    }

    let cancelled = false;
    let background: MatterBackground | undefined;

    // Defer the physics scene until the browser is idle: the matter-js vendor
    // chunk (~84KB) must not block the login screen's first interaction.
    const startBackground = () => {
      void import('../components/matterBackground').then(({ createMatterBackground }) => {
        if (cancelled || !matterHostRef.current) {
          return;
        }

        background = createMatterBackground({
          getTitle: () => 'EEG Ecosystem',
          host,
          pointerRef: pointerTargetRef,
          titleFontSize: (width) => (width > 420 ? 31 : Math.max(20, Math.min(25, width * 0.072))),
        });
      });
    };

    // Optional in older engines, so detect through an intersection view of
    // window instead of relying on the DOM lib's non-optional declarations.
    const idleApi = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (callback: () => void) => number;
    };

    const idleId = idleApi.requestIdleCallback
      ? idleApi.requestIdleCallback(startBackground)
      : window.setTimeout(startBackground, 200);

    return () => {
      cancelled = true;

      if (idleApi.cancelIdleCallback) {
        idleApi.cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId);
      }

      background?.destroy();
    };
  }, []);

  useEffect(() => {
    if (!hasError) {
      return;
    }

    const timer = window.setTimeout(() => {
      setHasError(false);
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [hasError]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting) {
      return;
    }

    setSuccessMessage('');
    const username = account.trim();

    if (!username || !password || (isSignup || isReset) && password !== confirmPassword) {
      setErrorMessage(
        (isSignup || isReset) && password !== confirmPassword
          ? '两次输入的密码不一致。'
          : '请输入账号和密码。',
      );
      setHasError(true);
      return;
    }

    if (isReset && !resetCode.trim()) {
      setErrorMessage('请输入重置码。');
      setHasError(true);
      return;
    }

    setIsSubmitting(true);

    try {
      if (isSignup) {
        await signUp(username, password);
      } else if (isReset) {
        await resetPassword(username, resetCode, password);
      } else {
        await signIn(username, password);
      }

      if (isReset) {
        setAuthMode('signin');
        setPassword('');
        setConfirmPassword('');
        setResetCode('');
        setShowPassword(false);
        setErrorMessage('');
        setHasError(false);
        setSuccessMessage('密码已重置，请使用新密码登录。');
        return;
      }

      const bounds = leftPanelRef.current?.getBoundingClientRect();

      if (bounds) {
        setExitStyle({
          '--exit-height': `${bounds.height}px`,
          '--exit-left': `${bounds.left}px`,
          '--exit-top': `${bounds.top}px`,
          '--exit-width': `${bounds.width}px`,
        } as CSSProperties);
      }

      setHasError(false);
      setIsExiting(true);
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      exitTimeoutRef.current = window.setTimeout(() => {
        navigate('/home');
      }, reducedMotion ? 0 : 940);
    } catch (error) {
      setErrorMessage(translateAuthError(error));
      setHasError(true);
      setIsShaking(false);

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setIsShaking(true);
        });
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleModeChange = (mode: 'signin' | 'signup' | 'reset') => {
    setAuthMode(mode);
    setErrorMessage('');
    setHasError(false);
    setIsShaking(false);
    setShowPassword(false);
    setSuccessMessage('');
  };

  const handleLeftPanelPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();

    pointerTargetRef.current = {
      active: true,
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
  };

  const handleLeftPanelPointerLeave = () => {
    pointerTargetRef.current = {
      ...pointerTargetRef.current,
      active: false,
    };
  };

  return (
    <Box
      className={`${styles.container} ${isExiting ? styles.isExiting : ''} relative box-border flex justify-center gap-0 overflow-hidden`}
      style={exitStyle}
    >
      <Box
        ref={leftPanelRef}
        className={`${styles.leftPanel} relative box-border flex touch-none items-center justify-center overflow-hidden text-white opacity-0`}
        onPointerMove={handleLeftPanelPointerMove}
        onPointerLeave={handleLeftPanelPointerLeave}
        aria-label="EEG Ecosystem animated scene"
      >
        <div
          className={`${styles.glassScene} pointer-events-none absolute inset-0 z-0 overflow-hidden`}
          aria-hidden="true"
        >
          <div ref={matterHostRef} className="absolute inset-0 opacity-100" />
        </div>
      </Box>

      <Box className={`${styles.rightPanel} box-border flex flex-1 items-center justify-center overflow-hidden opacity-0`}>
        <Box className={`${styles.formPanel} flex w-full max-w-360px flex-col items-center opacity-0`}>
          <span className={styles.brandMark} aria-hidden="true" />
          <Typography variant="h4" component="h1" className={`${styles.title} mb-8px text-center`}>
            EEG Ecosystem
          </Typography>
          <Typography variant="body2" className={`${styles.subtitle} mb-34px text-center`}>
            {isSignup ? '创建账号以开始使用。' : isReset ? '重置你的登录密码。' : '登录后继续实验。'}
          </Typography>

          <form onSubmit={handleAuthSubmit} className="w-full">
            <Box className={`${styles.fieldGroup} mb-24px flex flex-col gap-16px ${hasError ? styles.isError : ''}`}>
              <TextField
                className={`${styles.textField} ${isShaking ? styles.isShaking : ''}`}
                value={account}
                onChange={(event) => {
                  setAccount(event.target.value);
                  setSuccessMessage('');
                }}
                label="账号"
                placeholder="请输入账号"
                autoComplete="username"
                error={hasError}
                fullWidth
                variant="outlined"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <PersonRoundedIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  },
                }}
              />

              {isReset ? (
                <TextField
                  className={styles.textField}
                  value={resetCode}
                  onChange={(event) => {
                    setResetCode(event.target.value);
                    setSuccessMessage('');
                  }}
                  label="重置码"
                  placeholder="请输入管理员重置码"
                  autoComplete="off"
                  fullWidth
                  type="password"
                  variant="outlined"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <LockRoundedIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              ) : null}

              <TextField
                className={`${styles.textField} ${isShaking ? styles.isShaking : ''}`}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setSuccessMessage('');
                }}
                label={isReset ? '新密码' : '密码'}
                placeholder={isReset ? '请输入新密码' : '请输入密码'}
                autoComplete={isSignup || isReset ? 'new-password' : 'current-password'}
                error={hasError}
                fullWidth
                type={showPassword ? 'text' : 'password'}
                variant="outlined"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockRoundedIcon fontSize="small" />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          edge="end"
                          size="small"
                          onClick={() => setShowPassword((value) => !value)}
                          aria-label={showPassword ? '隐藏密码' : '显示密码'}
                        >
                          {showPassword ? (
                            <VisibilityOffRoundedIcon fontSize="small" />
                          ) : (
                            <VisibilityRoundedIcon fontSize="small" />
                          )}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />

              {isSignup || isReset ? (
                <TextField
                  className={styles.textField}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  label="确认密码"
                  placeholder="请再次输入密码"
                  autoComplete="new-password"
                  fullWidth
                  type={showPassword ? 'text' : 'password'}
                  variant="outlined"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <LockRoundedIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              ) : null}

              <p className={`${styles.errorMsg} pl-2px`}>{errorMessage}</p>
              {successMessage ? (
                <p className={`${styles.successMsg} pl-2px`} role="status">
                  {successMessage}
                </p>
              ) : null}
            </Box>

            <Button
              type="submit"
              className={`${styles.submitButton} mb-24px h-50px w-full px-22px`}
              disabled={isSubmitting}
              fullWidth
              variant="contained"
            >
              {isSubmitting ? '请稍候...' : isSignup ? '注册' : isReset ? '重置密码' : '登录'}
            </Button>

            <Button
              type="button"
              className={`${styles.modeSwitchButton} mb-18px w-full px-0`}
              fullWidth
              variant="text"
              onClick={() => handleModeChange(isSignup || isReset ? 'signin' : 'signup')}
            >
              {isSignup || isReset ? '返回登录' : '还没有账号？立即注册'}
            </Button>

            {!isSignup && !isReset ? (
              <Button
                type="button"
                className={`${styles.forgotPassword} mb-18px w-full px-0 text-center`}
                fullWidth
                variant="text"
                onClick={() => handleModeChange('reset')}
              >
                忘记密码？
              </Button>
            ) : null}
          </form>
        </Box>
      </Box>
    </Box>
  );
}
