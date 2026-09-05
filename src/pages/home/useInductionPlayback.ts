import { useCallback, useEffect, useState } from 'react';

/**
 * Induction-video playback state for the effect-evaluation wizard page
 * (node ②): whether the operator started the induction video, the mid-run
 * failure flag with its remount-retry counter, and the step-change reset.
 * Leaving the induction step (or resetting the flow) unmounts the player by
 * clearing the playing flag.
 */
export function useInductionPlayback(step: number) {
  // The induction video only mounts after the operator explicitly starts the
  // induction (EEG association + paradigm-session guard ride on that entry).
  const [isInductionPlaying, setIsInductionPlaying] = useState(false);
  // R7: a video that fails mid-run (file moved/corrupted) must not strand the
  // induction step - the error branch offers a remount retry or a way back.
  const [inductionVideoFailed, setInductionVideoFailed] = useState(false);
  const [inductionRetryCount, setInductionRetryCount] = useState(0);

  useEffect(() => {
    if (step !== 1) {
      setIsInductionPlaying(false);
      setInductionVideoFailed(false);
    }
  }, [step]);

  const startInductionPlayback = useCallback(() => {
    setIsInductionPlaying(true);
  }, []);

  // R7: remounts the player after a load failure (the retry counter rides on
  // the element key so a fresh <video> re-fetches the file).
  const retryInductionVideo = useCallback(() => {
    setInductionVideoFailed(false);
    setInductionRetryCount((count) => count + 1);
    setIsInductionPlaying(true);
  }, []);

  return {
    inductionRetryCount,
    inductionVideoFailed,
    isInductionPlaying,
    retryInductionVideo,
    setInductionVideoFailed,
    startInductionPlayback,
  };
}
