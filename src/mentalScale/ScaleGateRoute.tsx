import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getMentalScaleForPath, type MentalScaleAnswers } from './mentalScaleGate';
import MentalScaleDialog from './MentalScaleDialog';
import { buildMentalScaleStatus, updateMentalScaleStatus } from './mentalScaleStatus';
import { persistMentalScaleSubmission } from './scaleRecordsApi';
import {
  consumeScaleSkip,
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
  const { currentUser } = useAuth();
  const scale = getMentalScaleForPath(location.pathname);
  const [isAllowed, setIsAllowed] = useState(
    () => scale === null || isScaleSatisfiedForPath(scale.path),
  );
  const evaluatedPathRef = useRef(location.pathname);

  // Re-evaluate ONLY when the path actually changes (the same mounted gate
  // instance serves all three gated routes). Effects here must not re-read
  // the store on a re-run for the SAME path: under StrictMode the effects
  // execute setup → cleanup → setup, and the consume effect below spends the
  // skip pass in between — a same-path re-read would then see no skip and no
  // completion, flip isAllowed back to false, and pop the scale dialog a
  // second time right after the operator skipped it.
  useEffect(() => {
    if (evaluatedPathRef.current === location.pathname) {
      return;
    }
    evaluatedPathRef.current = location.pathname;
    setIsAllowed(scale === null || isScaleSatisfiedForPath(scale.path));
  }, [location.pathname, scale]);

  // The skip pass is spent HERE, at the final checkpoint, once the gated page
  // has actually mounted: the next navigation into a gated page re-prompts.
  // Consume runs on every allowed passage, which is a no-op when the gate
  // opened on a completion inside its grace window.
  useEffect(() => {
    if (scale !== null && isAllowed) {
      consumeScaleSkip(scale.path);
    }
  }, [scale, isAllowed]);

  if (scale === null || isAllowed) {
    return <Outlet />;
  }

  const handleComplete = (answers: MentalScaleAnswers) => {
    updateMentalScaleStatus(buildMentalScaleStatus(scale, answers));
    recordScaleCompletion(scale.path);
    // Mirror the submission into the backend scale_records table; a failure
    // only logs so the gate flow keeps working offline.
    persistMentalScaleSubmission(scale, answers, currentUser?.id ?? null);
    setIsAllowed(true);
  };

  const handleSkip = () => {
    // Skip only lifts the gate for this attempt; the effect above consumes it
    // once the page mounts, so the next navigation re-prompts.
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
