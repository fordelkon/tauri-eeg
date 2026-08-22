import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import { EegProvider } from './eeg/EegSessionContext';

const Login = lazy(() => import('./pages/Login'));
const Home = lazy(() => import('./pages/Home'));
const NotFound = lazy(() => import('./pages/NotFound'));
const EegAcquisition = lazy(() => import('./pages/home/EegAcquisition'));
const GameRegulation = lazy(() => import('./pages/home/GameRegulation'));
const HomeOverview = lazy(() => import('./pages/home/HomeOverview'));
const MusicRegulation = lazy(() => import('./pages/home/MusicRegulation'));
const VideoRegulation = lazy(() => import('./pages/home/VideoRegulation'));

function LoginRoute() {
  const { currentUser } = useAuth();

  if (currentUser) {
    return <Navigate to="/home" replace />;
  }

  return (
    <Suspense fallback={null}>
      <Login />
    </Suspense>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={null}>
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
            <Route path="/video-regulation" element={<VideoRegulation />} />
            <Route path="/game-regulation" element={<GameRegulation />} />
            <Route path="/music-regulation" element={<MusicRegulation />} />
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
