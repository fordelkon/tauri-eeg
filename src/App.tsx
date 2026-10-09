import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import styles from './App.module.css';

const ScaleGateRoute = lazy(() => import('./mentalScale/ScaleGateRoute'));

const Login = lazy(() => import('./pages/Login'));
const Home = lazy(() => import('./pages/Home'));
const NotFound = lazy(() => import('./pages/NotFound'));
// MUI ThemeProvider + themed CssBaseline: loading it lazily keeps the entry
// chunk MUI-free, so the boot shell paints before any vendor-mui code parses.
const AppShell = lazy(() => import('./AppShell'));
const ExperimentSettings = lazy(() => import('./pages/home/ExperimentSettings'));
const EffectEvaluation = lazy(() => import('./pages/home/EffectEvaluation'));
const GameRegulation = lazy(() => import('./pages/home/GameRegulation'));
const HomeOverview = lazy(() => import('./pages/home/HomeOverview'));
const MusicRegulation = lazy(() => import('./pages/home/MusicRegulation'));
const VideoRegulation = lazy(() => import('./pages/home/VideoRegulation'));

// Shared fallback for route-level Suspense boundaries: keeps lazy chunk loads
// from flashing a blank viewport between routes.
const routeFallback = (
  <div className={styles.routeFallback} role="status">
    <span className={styles.routeSpinner} aria-hidden="true" />
    <span className={styles.routeFallbackText}>加载中…</span>
  </div>
);

function LoginRoute() {
  const { currentUser } = useAuth();

  if (currentUser) {
    return <Navigate to="/home" replace />;
  }

  return (
    <Suspense fallback={routeFallback}>
      <Login />
    </Suspense>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={routeFallback}>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginRoute />} />
        <Route element={<ProtectedRoute />}>
          <Route
            element={
              <Suspense fallback={routeFallback}>
                <Home />
              </Suspense>
            }
          >
            <Route path="/home" element={<HomeOverview />} />
            <Route path="/experiment-settings" element={<ExperimentSettings />} />
            {/* The evaluation flow orchestrates its own scale phases, so it
                sits outside the standalone regulation-page gate. */}
            <Route path="/effect-evaluation" element={<EffectEvaluation />} />
            {/* Regulation pages require a recent mental-scale completion:
                the gate also covers direct URL entry / page refreshes. */}
            <Route element={<ScaleGateRoute />}>
              <Route path="/video-regulation" element={<VideoRegulation />} />
              <Route path="/game-regulation" element={<GameRegulation />} />
              <Route path="/music-regulation" element={<MusicRegulation />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Suspense fallback={routeFallback}>
          <AppShell>
            <AppRoutes />
          </AppShell>
        </Suspense>
      </Router>
    </AuthProvider>
  );
}

export default App;
