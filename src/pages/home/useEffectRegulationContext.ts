import { useEffect, useRef, useState } from 'react';
import {
  FLOW_STORAGE_KEY,
  readRegulationPageContext,
  type EffectRegulationMethod,
  type RegulationPageContext,
} from './effectEvaluationFlow';

/**
 * Cheap prefilter in front of the full JSON.parse inside
 * `readRegulationPageContext`. `FLOW_STORAGE_KEY` is written exclusively by
 * `writeFlowStateToStorage` (a no-whitespace `JSON.stringify` of the flow
 * state), so a live step-3 window always serializes as `"step":3` with a
 * non-null `"regulationStartedAtMs"` — and anything else (no key at all,
 * wizard mid-flow, window not started/closed) lacks one of those markers.
 * Skipping the parse when no window can be live removes a 2 Hz JSON.parse
 * from the whole idle lifetime of the regulation pages; a prefilter hit
 * still runs the authoritative parse, so corrupt/legacy payloads behave
 * exactly as before. String values cannot fake a marker because
 * `JSON.stringify` escapes inner quotes (e.g. `\"step\":3`).
 */
function readLiveWindowContext(
  method: EffectRegulationMethod,
  nowMs: number,
): RegulationPageContext | null {
  const raw = window.sessionStorage.getItem(FLOW_STORAGE_KEY);

  if (
    raw === null
    || !raw.includes('"step":3')
    || !raw.includes('"regulationStartedAtMs":')
    || raw.includes('"regulationStartedAtMs":null')
  ) {
    return null;
  }

  return readRegulationPageContext(window.sessionStorage, method, nowMs);
}

/**
 * Consumes the effect-evaluation run context on a regulation page (R4/F4).
 *
 * While the wizard's step-3 window is live and its method matches this page,
 * the hook exposes the target emotion label and the remaining seconds, and
 * keeps invoking `onWindowElapsed` once the window has run to zero so the
 * page can hold its playback stopped. The wizard route is unmounted during
 * the regulation, so the state is read through sessionStorage at a 500ms
 * cadence (the same clock the wizard countdown uses); reads with no possible
 * live window skip the flow-state parse entirely.
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
    () => readLiveWindowContext(method, Date.now()),
  );
  const onWindowElapsedRef = useRef(onWindowElapsed);

  useEffect(() => {
    onWindowElapsedRef.current = onWindowElapsed;
  }, [onWindowElapsed]);

  useEffect(() => {
    const tick = () => {
      const current = readLiveWindowContext(method, Date.now());

      // Re-render only when the exposed value actually changed: identical
      // 1 Hz countdown readings (and the null → null idle case) keep the
      // previous reference so React bails out without re-rendering.
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
