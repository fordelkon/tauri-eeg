import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { buildParadigmQueue } from './paradigmApi';
import { useMaterialLibraryLoader } from './useMaterialLibrary';
import { readStoredLibraryRootPath, writeStoredLibraryRootPath } from './paradigmStorage';
import { toLibraryErrorMessage } from './paradigmSessionKinds';
import type {
  ParadigmEmotion,
  ParadigmSessionKind,
  ParadigmTrialPlanItem,
  ParadigmVideoEntry,
} from './types';
const QUEUE_PREVIEW_DEBOUNCE_MS = 300;
type QueuePreviewInputs = {
  rootPath: string;
  sessionRunId: string;
  sessionKind: ParadigmSessionKind;
};
export function useParadigmVideoLibrary(options: {
  sessionKind: ParadigmSessionKind;
  sessionRunId: string;
}) {
  const { sessionKind, sessionRunId } = options;
  const { loader, state: libraryState } = useMaterialLibraryLoader();
  const library =
    libraryState.kind === 'ready' || libraryState.kind === 'invalid' ? libraryState.library : null;
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [choosingLibrary, setChoosingLibrary] = useState(false);
  const loadingLibrary = choosingLibrary || libraryState.kind === 'loading';
  const selectionGeneration = useRef(0);
  const [queuePreview, setQueuePreview] = useState<ParadigmTrialPlanItem[] | null>(null);
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
  useEffect(() => {
    const storedRootPath = readStoredLibraryRootPath();
    if (storedRootPath) {
      void loader.load(storedRootPath).then((result) => {
        if (result?.kind === 'invalid') {
          writeStoredLibraryRootPath('');
          void loader.load('');
        }
      });
    }

    return () => {
      selectionGeneration.current += 1;
      loader.cancel();
    };
  }, [loader]);
  useEffect(() => {
    if (loadingLibrary || !library?.valid || !sessionRunId.trim()) {
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
  }, [library, loadingLibrary, sessionRunId, sessionKind]);
  const clearQueuePreview = useCallback(() => {
    queuePreviewInputsRef.current = null;
    setQueuePreview(null);
  }, []);

  const chooseLibraryRoot = useCallback(async () => {
    const selection = ++selectionGeneration.current;
    loader.cancel();
    setChoosingLibrary(true);
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

      if (selection !== selectionGeneration.current || typeof selected !== 'string') {
        return;
      }

      const result = await loader.load(selected);
      if (!result || selection !== selectionGeneration.current) return;
      if (result.kind === 'ready' || result.kind === 'invalid') {
        writeStoredLibraryRootPath(result.kind === 'ready' ? selected : '');
      }
      if (result.kind === 'invalid') {
        setLibraryError('视频库校验未通过,请根据提示调整目录内容。');
      } else if (result.kind === 'failed') {
        setLibraryError(toLibraryErrorMessage(result.error));
      }
    } catch (error) {
      if (selection === selectionGeneration.current) setLibraryError(toLibraryErrorMessage(error));
    } finally {
      if (selection === selectionGeneration.current) setChoosingLibrary(false);
    }
  }, [clearQueuePreview, loader]);

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
