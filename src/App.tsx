import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Home from './pages/Home';
import NotFound from './pages/NotFound';
import EegAcquisition from './pages/home/EegAcquisition';
import GameRegulation from './pages/home/GameRegulation';
import HomeOverview from './pages/home/HomeOverview';
import MusicRegulation from './pages/home/MusicRegulation';
import VideoRegulation from './pages/home/VideoRegulation';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/home" element={<Home />}>
          <Route index element={<HomeOverview />} />
          <Route path="eeg-acquisition" element={<EegAcquisition />} />
          <Route path="video-regulation" element={<VideoRegulation />} />
          <Route path="game-regulation" element={<GameRegulation />} />
          <Route path="music-regulation" element={<MusicRegulation />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
}

export default App;
