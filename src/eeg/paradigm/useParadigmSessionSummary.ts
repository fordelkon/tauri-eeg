import { useEffect, useRef, useState } from 'react';
import { getEegStatus } from '../eegApi';
import { getParadigmSessionSummary } from './paradigmApi';
import { toCommandErrorMessage } from './paradigmCommandErrors';
import type { ParadigmSessionSummary } from './types';

/**
 * Finished-session summary for the paradigm runner: fires exactly once when
 * the reducer reaches the `finished` phase and loads the per-class trial
 * statistics. Dry runs summarize their locally collected records instead of
 * touching the backend (they wrote nothing anywhere).
 *
 * Prefer the id resolved at mount: stopRecord() (the context wrapper)
 * resolves to a boolean, not the finished recording, so the previously
 * resolved value is the only source that skips the extra status roundtrip.
 * The fallback polls status BEFORE stopping — activeRecording is cleared
 * once the continuous recording stops.
 */
export function useParadigmSessionSummary(options: {
  phase: string;
  sessionId: string | null;
  dryRun: boolean;
  /** Local summary builder for dry runs (already collected trial records). */
  summarizeDryRun: () => ParadigmSessionSummary | null;
  stopRecord: () => Promise<boolean>;
}) {
  const { phase, sessionId, dryRun, summarizeDryRun, stopRecord } = options;
  const [summary, setSummary] = useState<ParadigmSessionSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const finishHandledRef = useRef(false);

  useEffect(() => {
    if (phase !== 'finished' || finishHandledRef.current) {
      return;
    }
    finishHandledRef.current = true;

    if (dryRun) {
      setSummary(summarizeDryRun());
      return;
    }

    void (async () => {
      try {
        let resolvedSessionId = sessionId;
        if (!resolvedSessionId) {
          const status = await getEegStatus();
          resolvedSessionId = status.activeRecording?.id ?? null;
        }

        await stopRecord();

        if (!resolvedSessionId) {
          setSummaryError('无法确定 Session ID,未能加载训练前统计。');
          return;
        }

        setSummary(await getParadigmSessionSummary(resolvedSessionId));
      } catch (error) {
        setSummaryError(toCommandErrorMessage(
          '训练前统计加载失败',
          error,
          'Summary could not be loaded.',
        ));
      }
    })();
  }, [phase, sessionId, dryRun, summarizeDryRun, stopRecord]);

  return { summary, summaryError };
}
