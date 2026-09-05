// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (url: URL) => readFileSync(url, 'utf8');

/**
 * App-wide wall-clock / animation-loop contract (render-cost regression guard,
 * sibling of effectTickConfinement.test.ts which pins the effect-evaluation
 * wizard tree).
 *
 * The repo's vitest environment is plain node (no DOM / component mounting
 * stack), so the contract is pinned at the source level:
 *
 * 1. Every recurring `window.setInterval` in src must live in the audited
 *    allowlist below. Each entry is a leaf-isolated ticker or a poll gated on
 *    the resource it serves, and each cleans up after itself. Adding a new
 *    interval anywhere else fails this test on purpose: it forces the author
 *    to either gate/leaf-isolate it or consciously extend this list.
 *
 * 2. Long-running rAF loops (EEG waveform frames, matter physics scene) must
 *    stay throttled, visibility-gated and cancel-cleaned, and every one-shot
 *    rAF (resize coalescing, scroll sync) must cancel its frame on unmount.
 *
 * 3. The 30 Hz EEG display snapshot must stay confined to the RealtimeMonitor
 *    leaf (via useRealtimeEeg): it may never enter EegSessionContext state or
 *    its context value, or every context consumer in the Home tree would
 *    re-render per frame.
 */

const SRC_ROOT = new URL('../', import.meta.url);

function collectSourceFiles(dir: URL): URL[] {
  const files: URL[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryUrl));
      continue;
    }

    if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
      && !entry.name.includes('.test.')
    ) {
      files.push(entryUrl);
    }
  }

  return files;
}

const srcFiles = collectSourceFiles(SRC_ROOT);

/**
 * The complete, audited set of recurring wall-clock intervals.
 * Format: path, cadence, and why the cadence is confined.
 */
const intervalAllowlist = [
  {
    // 250 ms thinking-elapsed ticker; runs only while the planner streams and
    // re-renders only the ThinkingTimer leaf, never the panel.
    path: 'src/agent/ExperimentAgentPanel.tsx',
  },
  {
    // 100 ms countdown probe; stored value only moves once per second
    // (coalesceCountdownTickMs) so the fullscreen stage re-renders at ~1 Hz,
    // and the interval lives only for phases with a fixed duration.
    path: 'src/eeg/paradigm/TrialStageRenderer.tsx',
  },
  {
    // 1 Hz 已录 header clock; RecordingClock leaf mounted only while a
    // recording is active.
    path: 'src/pages/home/EegAcquisition.tsx',
  },
  {
    // 500 ms condition-window poll; gated off before start/after expiry and
    // leaf-confined by effectTickConfinement.test.ts. Do not touch without
    // reading that contract first.
    path: 'src/pages/home/EffectConditionCountdown.tsx',
  },
  {
    // 1 Hz device-start reconciliation poll; exists only while
    // deviceStatus === 'starting' (the start-timeout window).
    path: 'src/eeg/useEegDeviceCommands.ts',
  },
  {
    // 500 ms generation-elapsed counter; the panel is mounted only while a
    // music generation wait is active and re-renders only itself.
    path: 'src/pages/home/MusicGenerationProgress.tsx',
  },
  {
    // 500 ms sessionStorage read of the wizard's live regulation window on
    // standalone regulation pages; the string prefilter skips the JSON.parse
    // whenever no window can be live, and identical readings bail out of the
    // state update.
    path: 'src/pages/home/useEffectRegulationContext.ts',
  },
] as const;

// Discovered owners are compared as URL-relative paths (forward slashes on
// every platform), so the allowlist is written in the same form.
const allowlistedPaths = intervalAllowlist.map((entry) => entry.path);

describe('app-wide wall-clock interval contract', () => {
  test('every recurring interval lives in the audited allowlist', () => {
    const owners = srcFiles.filter((file) => readText(file).includes('window.setInterval('));

    expect(
      owners.map((file) => file.href.replace(SRC_ROOT.href, '')).sort(),
      'A new window.setInterval appeared outside the allowlist — gate it behind its resource, confine it to a leaf, clean it up, then (only then) add it to intervalAllowlist.',
    ).toEqual([...allowlistedPaths].sort());
  });

  test('every allowlisted interval cleans up after itself', () => {
    for (const path of allowlistedPaths) {
      const source = readText(new URL(path, SRC_ROOT));

      expect(source, `${path} must clear its interval on unmount/phase exit`).toContain(
        'window.clearInterval(',
      );
    }
  });
});

describe('rAF loop contract', () => {
  test('the EEG render loop only runs while streaming and pauses when hidden', () => {
    const source = readText(new URL('src/eeg/useRealtimeEeg.ts', SRC_ROOT));

    // Loop lifecycle is derived from the streaming state (no always-on rAF
    // burning wakeups while the device is idle)…
    expect(source).toContain("eegSession.deviceStatus === 'streaming'");
    // …paused on document.hidden and resumed on show…
    expect(source).toContain('document.hidden');
    expect(source).toContain('visibilitychange');
    // …and the pending frame is cancelled in cleanup.
    expect(source).toContain('cancelAnimationFrame');
  });

  test('the matter background scene is throttled, visibility- and visibility-of-host-gated', () => {
    const source = readText(new URL('src/components/matterBackground.ts', SRC_ROOT));

    // ~30 fps throttle (FRAME_INTERVAL_MS)…
    expect(source).toContain('FRAME_INTERVAL_MS');
    // …page-visibility gating…
    expect(source).toContain('document.hidden');
    // …and host-visibility gating (scene mounted offscreen costs nothing).
    expect(source).toContain('IntersectionObserver');
    expect(source).toContain('cancelAnimationFrame');
  });

  test('one-shot rAF uses cancel their frames on unmount', () => {
    const oneShotRafFiles = [
      'src/eeg/EegWaveformPanel.tsx',
      'src/agent/ExperimentAgentPanel.tsx',
      'src/mentalScale/GlobalMentalScalePanel.tsx',
      'src/pages/home/EffectResultChartView.tsx',
    ] as const;

    for (const path of oneShotRafFiles) {
      const source = readText(new URL(path, SRC_ROOT));

      expect(source, `${path} must cancelAnimationFrame in cleanup`).toContain(
        'cancelAnimationFrame',
      );
    }
  });
});

describe('30Hz EEG snapshot confinement contract', () => {
  test('the display snapshot state lives only in useRealtimeEeg', () => {
    const contextSource = readText(new URL('src/eeg/EegSessionContext.tsx', SRC_ROOT));
    const hookSource = readText(new URL('src/eeg/useRealtimeEeg.ts', SRC_ROOT));

    // The single owner of the 30 Hz snapshot state…
    expect(hookSource).toContain('setSnapshot');
    // …and it must never leak into the shared session context: its value is
    // memoized on reducer fields + settings + stable callbacks only, so the
    // ~15 Hz setSnapshot re-renders cannot reach any other context consumer.
    expect(contextSource).not.toContain('setSnapshot');
    expect(contextSource).not.toContain('useState<EegDisplaySnapshot');
    expect(contextSource).not.toContain('snapshot,');
  });

  test('the 30Hz subtree stays leaf-isolated in EegAcquisition', () => {
    const source = readText(new URL('src/pages/home/EegAcquisition.tsx', SRC_ROOT));

    // RealtimeMonitor owns useRealtimeEeg and is memoized, so per-frame
    // re-renders stop at the monitor grid + footer; the controls strip, the
    // paradigm panel and the page header never see them.
    expect(source).toContain('memo(function RealtimeMonitor');
    expect(source).toContain('const eeg = useRealtimeEeg();');
    // The page root consumes the session context, not the snapshot hook.
    expect(source).toContain('useEegSession()');
    // The channel checkboxes are memoized against the per-frame re-renders.
    expect(source).toContain('EegChannelList');
  });
});
