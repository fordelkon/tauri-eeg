import { useEffect, useRef, useState } from 'react';
import {
  readRegulationPageContext,
  type EffectRegulationMethod,
  type RegulationPageContext,
} from './effectEvaluationFlow';

/**
 * Consumes the effect-evaluation run context on a regulation page (R4/F4).
 *
 * While the wizard's step-3 window is live and its method matches this page,
 * the hook exposes the target emotion label and the remaining seconds, and
 * keeps invoking `onWindowElapsed` once the window has run to zero so the
 * page can hold its playback stopped. The wizard route is unmounted during
 * the regulation, so the state is read through sessionStorage at a 500ms
 * cadence (the same clock the wizard countdown uses).
 *
 * Unrelated visits see no matching live window (`null`) and are untouched;
 * the repeated elapsed callback stays idempotent because pausing an already
 * paused media element is a no-op — this also re-stops content an operator
 * manually restarted after the window closed.
 */
export function useEffectRegulationContext(
  method: EffectRegulationMethod,
  onWindowElapsed: () => void,
): RegulationPageContext | null {
  const [context, setContext] = useState<RegulationPageContext | null>(
    () => readRegulationPageContext(window.sessionStorage, method, Date.now()),
  );
  const onWindowElapsedRef = useRef(onWindowElapsed);

  useEffect(() => {
    onWindowElapsedRef.current = onWindowElapsed;
  }, [onWindowElapsed]);

  useEffect(() => {
    const tick = () => {
      const current = readRegulationPageContext(window.sessionStorage, method, Date.now());

      setContext((previous) => (
        previous !== null
          && current !== null
          && previous.emotionLabel === current.emotionLabel
          && previous.remainingSeconds === current.remainingSeconds
          ? previous
          : current
      ));

      if (current !== null && current.remainingSeconds === 0) {
        onWindowElapsedRef.current();
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 500);

    return () => window.clearInterval(intervalId);
  }, [method]);

  return context;
}
