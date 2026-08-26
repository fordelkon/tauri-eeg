import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import { EegProvider } from './eeg/EegSessionContext';
import ScaleGateRoute from './mentalScale/ScaleGateRoute';
import styles from './App.module.css';

const Login = lazy(() => import('./pages/Login'));
const Home = lazy(() => import('./pages/Home'));
const NotFound = lazy(() => import('./pages/NotFound'));
const EegAcquisition = lazy(() => import('./pages/home/EegAcquisition'));
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
            element={(
              <EegProvider>
                <Home />
              </EegProvider>
            )}
          >
            <Route path="/home" element={<HomeOverview />} />
            <Route path="/eeg-acquisition" element={<EegAcquisition />} />
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
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

export default App;
