import { describe, expect, test } from 'vitest';
import { createMaterialLibraryLoader } from '../../src/paradigm/materialLibraryLoader';
import type { ParadigmVideoLibrary } from '../../src/paradigm/types';

function library(rootPath: string, valid = true): ParadigmVideoLibrary {
  return {
    rootPath, valid,
    anxiety: [{ videoId: 'anxiety-1', fileName: 'anxiety.mp4', absolutePath: `${rootPath}/anxiety.mp4` }],
    depression: [], calm: [], fear: [],
    problems: valid ? [] : ['Missing Calm directory'], readinessWarnings: [],
  };
}

function pendingScan() {
  let complete: (value: ParadigmVideoLibrary) => void = () => { throw new Error('Scan not started'); };
  let fail: (error: unknown) => void = () => { throw new Error('Scan not started'); };
  const result = new Promise<ParadigmVideoLibrary>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  return { result, complete, fail };
}

describe('material directory lifecycle', () => {
  test('publishes loading with the requested directory before the scan completes', async () => {
    const scan = pendingScan();
    const requested: string[] = [];
    const loader = createMaterialLibraryLoader((root) => { requested.push(root); return scan.result; });
    const snapshots: string[] = [];
    loader.subscribe(() => snapshots.push(loader.getSnapshot().kind));

    const load = loader.load('/videos');
    expect(loader.getSnapshot()).toEqual({ kind: 'loading', rootPath: '/videos' });
    expect(requested).toEqual(['/videos']);
    scan.complete(library('/videos'));
    await load;

    expect(loader.getSnapshot()).toEqual({ kind: 'ready', rootPath: '/videos', library: library('/videos') });
    expect(snapshots).toEqual(['loading', 'ready']);
  });

  test('keeps the new directory when an earlier valid restore completes last', async () => {
    const oldScan = pendingScan();
    const newScan = pendingScan();
    const loader = createMaterialLibraryLoader((root) => root === '/old' ? oldScan.result : newScan.result);
    const oldLoad = loader.load('/old');
    const newLoad = loader.load('/new');
    newScan.complete(library('/new'));
    await newLoad;
    oldScan.complete(library('/old'));

    expect(await oldLoad).toBeNull();
    expect(loader.getSnapshot()).toEqual({ kind: 'ready', rootPath: '/new', library: library('/new') });
  });

  test('rejects stale invalid completion so callers cannot clear a newly selected stored root', async () => {
    const oldScan = pendingScan();
    const loader = createMaterialLibraryLoader((root) => root === '/old' ? oldScan.result : Promise.resolve(library(root)));
    const restore = loader.load('/old');
    await loader.load('/new');
    oldScan.complete(library('/old', false));
    expect(await restore).toBeNull();
    expect(loader.getSnapshot().kind).toBe('ready');
  });

  test('a stale failure cannot stop a pending scan of another directory', async () => {
    const oldScan = pendingScan();
    const newScan = pendingScan();
    const loader = createMaterialLibraryLoader((root) => root === '/old' ? oldScan.result : newScan.result);
    const first = loader.load('/old');
    const second = loader.load('/new');
    oldScan.fail(new Error('Drive disconnected'));
    expect(await first).toBeNull();
    expect(loader.getSnapshot()).toEqual({ kind: 'loading', rootPath: '/new' });
    newScan.complete(library('/new'));
    await second;
    expect(loader.getSnapshot().kind).toBe('ready');
  });

  test('preserves invalid library diagnostics without exposing it as usable', async () => {
    const loader = createMaterialLibraryLoader(async (root) => library(root, false));
    await loader.load('/incomplete');
    expect(loader.getSnapshot()).toEqual({
      kind: 'invalid', rootPath: '/incomplete', library: library('/incomplete', false),
    });
  });

  test('failure belongs to the requested directory and removes the earlier usable library', async () => {
    const loader = createMaterialLibraryLoader(async (root) => {
      if (root === '/missing') throw 'Directory does not exist';
      return library(root);
    });
    await loader.load('/videos');
    await loader.load('/missing');
    expect(loader.getSnapshot()).toEqual({ kind: 'failed', rootPath: '/missing', error: 'Directory does not exist' });
  });

  test('an empty directory clears the selection and supersedes an in-flight scan without invoking the scanner', async () => {
    const scan = pendingScan();
    const requested: string[] = [];
    const loader = createMaterialLibraryLoader((root) => { requested.push(root); return scan.result; });
    const load = loader.load('/videos');
    await loader.load('');
    scan.complete(library('/videos'));
    expect(await load).toBeNull();
    expect(loader.getSnapshot()).toEqual({ kind: 'idle' });
    expect(requested).toEqual(['/videos']);
  });

  test('cancellation prevents an unmounted consumer from receiving completion', async () => {
    const scan = pendingScan();
    const loader = createMaterialLibraryLoader(() => scan.result);
    const received: string[] = [];
    const unsubscribe = loader.subscribe(() => received.push(loader.getSnapshot().kind));
    const load = loader.load('/videos');
    unsubscribe();
    loader.cancel();
    scan.complete(library('/videos'));
    expect(await load).toBeNull();
    expect(received).toEqual(['loading']);
    expect(loader.getSnapshot()).toEqual({ kind: 'idle' });
  });

  test('leaving an active step retains completed material for the remaining run', async () => {
    const loader = createMaterialLibraryLoader(async (root) => library(root));
    await loader.load('/videos');
    loader.cancel();
    expect(loader.getSnapshot()).toEqual({ kind: 'ready', rootPath: '/videos', library: library('/videos') });
  });
});
