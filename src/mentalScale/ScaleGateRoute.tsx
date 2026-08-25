import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  getMentalScaleForPath,
  type MentalScaleAnswers,
} from './mentalScaleGate';
import MentalScaleDialog from './MentalScaleDialog';
import { buildMentalScaleStatus, updateMentalScaleStatus } from './mentalScaleStatus';
import {
  isScaleSatisfiedForPath,
  recordScaleCompletion,
  recordScaleSkip,
} from './scaleCompletion';

/**
 * Route-level mental-scale gate. The sidebar flow used to be the only
 * checkpoint, so entering a regulation page by typing its URL (or via
 * back/forward navigation) silently bypassed the scale. This guard wraps the
 * gated routes directly: without a recent completion the page does not mount
 * until the scale is answered or explicitly skipped.
 */
export default function ScaleGateRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const scale = getMentalScaleForPath(location.pathname);
  const [isAllowed, setIsAllowed] = useState(
    () => scale === null || isScaleSatisfiedForPath(scale.path),
  );

  // Re-evaluate whenever the path changes (component is remounted per route
  // by the key below, but keep this guard for safety).
  useEffect(() => {
    setIsAllowed(scale === null || isScaleSatisfiedForPath(scale.path));
  }, [scale]);

  if (scale === null || isAllowed) {
    return <Outlet />;
  }

  const handleComplete = (answers: MentalScaleAnswers) => {
    updateMentalScaleStatus(buildMentalScaleStatus(scale, answers));
    recordScaleCompletion(scale.path);
    setIsAllowed(true);
  };

  const handleSkip = () => {
    // Skip only lifts the gate for this attempt; the next navigation re-prompts.
    recordScaleSkip(scale.path);
    setIsAllowed(true);
  };

  const handleClose = () => {
    // Closing without answering means no entry: send the user back to the
    // overview instead of leaving them on an empty backdrop.
    navigate('/home', { replace: true });
  };

  return (
    <MentalScaleDialog
      key={scale.path}
      onComplete={handleComplete}
      onClose={handleClose}
      onSkip={handleSkip}
      scale={scale}
    />
  );
}
