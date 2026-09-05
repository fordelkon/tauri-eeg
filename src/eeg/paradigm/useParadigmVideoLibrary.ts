import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { buildParadigmQueue, loadParadigmVideoLibrary } from './paradigmApi';
import {
  readStoredLibraryRootPath,
  writeStoredLibraryRootPath,
} from './paradigmStorage';
import { toLibraryErrorMessage } from './paradigmSessionKinds';
import type {
  ParadigmEmotion,
  ParadigmSessionKind,
  ParadigmTrialPlanItem,
  ParadigmVideoEntry,
  ParadigmVideoLibrary,
} from './types';

/** Latency budget for the silent queue preview's backend directory scan. */
const QUEUE_PREVIEW_DEBOUNCE_MS = 300;

/** Inputs the current queuePreview was built from (build_paradigm_queue is
 *  deterministic per session_run_id, so a matching preview IS the queue the
 *  backend would rebuild at start). */
type QueuePreviewInputs = {
  rootPath: string;
  sessionRunId: string;
  sessionKind: ParadigmSessionKind;
};

/**
 * Video-library slice of the paradigm setup panel: library load/restore, the
 * silent deterministic queue preview (debounced backend directory scan), the
 * queue-preview reuse bookkeeping, and the fullscreen preview selection.
 * The start gate itself (device readiness, subject/run-id fields, dry-run)
 * stays on the panel.
 */
export function useParadigmVideoLibrary(options: {
  sessionKind: ParadigmSessionKind;
  sessionRunId: string;
}) {
  const { sessionKind, sessionRunId } = options;
  const [library, setLibrary] = useState<ParadigmVideoLibrary | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [queuePreview, setQueuePreview] = useState<ParadigmTrialPlanItem[] | null>(null);
  // Inputs behind the queuePreview above: startSession reuses the previewed
  // queue when these still match, skipping the second backend directory scan.
  const queuePreviewInputsRef = useRef<QueuePreviewInputs | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<{
    emotion: ParadigmEmotion;
    entry: ParadigmVideoEntry;
  } | null>(null);

  const selectedVideoIds = useMemo(
    () => new Set((queuePreview ?? []).map((item) => item.videoId)),
    [queuePreview],
  );

  // Restore the last validated video library root on mount (same best-effort
  // memory as subjectId). A directory that has gone missing or no longer
  // passes validation silently degrades to the unselected state.
  useEffect(() => {
    const storedRootPath = readStoredLibraryRootPath();
    if (!storedRootPath) {
      return;
    }

    let disposed = false;

    loadParadigmVideoLibrary(storedRootPath)
      .then((loaded) => {
        if (disposed) {
          return;
        }

        if (loaded.valid) {
          // Keep whichever library is already present (e.g. one the operator
          // just picked while the restore was in flight).
          setLibrary((current) => current ?? loaded);
        } else {
          writeStoredLibraryRootPath('');
        }
      })
      .catch(() => {
        // Directory may be unavailable (unplugged drive etc.); stay unselected.
      });

    return () => {
      disposed = true;
    };
  }, []);

  // Silent queue preview: feeds the 入选 badges whenever a valid library, run
  // id, and session kind are all present. build_paradigm_queue is
  // deterministic per session_run_id, so startSession reuses this queue (see
  // queuePreviewInputsRef) instead of rescanning the directory on the
  // start-click latency path.
  useEffect(() => {
    if (!library?.valid || !sessionRunId) {
      return;
    }

    let disposed = false;
    const timer = window.setTimeout(() => {
      buildParadigmQueue(library.rootPath, sessionRunId.trim(), sessionKind)
        .then((queue) => {
          if (!disposed) {
            queuePreviewInputsRef.current = {
              rootPath: library.rootPath,
              sessionRunId: sessionRunId.trim(),
              sessionKind,
            };
            setQueuePreview(queue);
          }
        })
        .catch((error) => {
          if (!disposed) {
            setQueueError(toLibraryErrorMessage(error));
          }
        });
    }, QUEUE_PREVIEW_DEBOUNCE_MS);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [library, sessionRunId, sessionKind]);

  // A changed input invalidates the previewed queue, so every input-changing
  // path clears both the queue and the inputs it was built from.
  const clearQueuePreview = useCallback(() => {
    queuePreviewInputsRef.current = null;
    setQueuePreview(null);
  }, []);

  const chooseLibraryRoot = useCallback(async () => {
    setLoadingLibrary(true);
    setLibraryError(null);
    clearQueuePreview();
    setQueueError(null);
    setPreviewVideo(null);

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择范式视频根目录',
      });

      if (typeof selected !== 'string') {
        return;
      }

      const loaded = await loadParadigmVideoLibrary(selected);
      setLibrary(loaded);
      // Only validated roots are remembered so the next launch restores a
      // usable library; an invalid pick clears any stale stored path.
      writeStoredLibraryRootPath(loaded.valid ? selected : '');
      if (!loaded.valid) {
        setLibraryError('视频库校验未通过,请根据提示调整目录内容。');
      }
    } catch (error) {
      setLibraryError(toLibraryErrorMessage(error));
    } finally {
      setLoadingLibrary(false);
    }
  }, [clearQueuePreview]);

  return {
    chooseLibraryRoot,
    clearQueuePreview,
    library,
    libraryError,
    loadingLibrary,
    previewVideo,
    queueError,
    queuePreview,
    queuePreviewInputsRef,
    selectedVideoIds,
    setLibraryError,
    setPreviewVideo,
    setQueueError,
  };
}
