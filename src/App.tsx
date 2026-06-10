import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import Login from './pages/Login';
import Home from './pages/Home';
import NotFound from './pages/NotFound';
import EegAcquisition from './pages/home/EegAcquisition';
import GameRegulation from './pages/home/GameRegulation';
import HomeOverview from './pages/home/HomeOverview';
import MusicRegulation from './pages/home/MusicRegulation';
import VideoRegulation from './pages/home/VideoRegulation';

function LoginRoute() {
  const { currentUser } = useAuth();

  if (currentUser) {
    return <Navigate to="/home" replace />;
  }

  return <Login />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Home />}>
          <Route path="/home" element={<HomeOverview />} />
          <Route path="/eeg-acquisition" element={<EegAcquisition />} />
          <Route path="/video-regulation" element={<VideoRegulation />} />
          <Route path="/game-regulation" element={<GameRegulation />} />
          <Route path="/music-regulation" element={<MusicRegulation />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
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
