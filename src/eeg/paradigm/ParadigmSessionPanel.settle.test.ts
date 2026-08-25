// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (url: URL) => readFileSync(url, 'utf8');

/**
 * The paradigm start settles on "any errorMessage" — so a stale error left by
 * an earlier free-recording attempt used to cancel pendingStart before the
 * IPC returned: the Runner never mounted while the backend kept recording.
 * The start path must clear the error in the same batch as the request.
 */
describe('ParadigmSessionPanel start settlement', () => {
  const panelTsx = readText(new URL('./ParadigmSessionPanel.tsx', import.meta.url));
  const contextTsx = readText(new URL('../EegSessionContext.tsx', import.meta.url));

  test('starting a session clears stale errors in the same batch as the request', () => {
    const startBlock = panelTsx.match(/const handleStartSession[\s\S]*?\n  \};/)?.[0] ?? '';

    expect(startBlock).toContain('eeg.resetError();');
    expect(startBlock.indexOf('eeg.resetError();'))
      .toBeLessThan(startBlock.indexOf('setPendingStart(request);'));
    expect(startBlock.indexOf('eeg.resetError();'))
      .toBeLessThan(startBlock.indexOf('void eeg.startRecord('));
  });

  test('settle effect only reads errors while a start request is pending', () => {
    const effectBlock = panelTsx.match(/useEffect\(\(\) => \{\s*if \(!pendingStart\)[\s\S]*?\}, \[pendingStart/)?.[0] ?? '';

    expect(effectBlock).toBeTruthy();
    expect(effectBlock).toContain("if (!pendingStart)");
    expect(effectBlock).toContain("if (eeg.errorMessage)");
    // Success still settles exclusively through the recording status flip.
    expect(effectBlock).toContain("if (eeg.recordStatus === 'recording')");
  });

  test('the context exposes resetError backed by the reducer action', () => {
    expect(contextTsx).toContain('resetError: () => void;');
    expect(contextTsx).toContain("dispatchSession({ type: 'reset_error' });");
  });
});
