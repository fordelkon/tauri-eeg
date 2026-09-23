// @ts-expect-error This project does not install Node type declarations for test-only imports.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (url: URL) => readFileSync(url, 'utf8');

/**
 * App-wide calm-style contract (sibling of timersContract.test.ts), pinning
 * the research-backed 平静 dialect at the source level:
 *
 * Terracotta (--calm-primary #c46757) is the ONLY control-fill hue; ink
 * (#2c2218 /
 * #172026) is text-only; brand red / brick red is decorative art or a
 * destructive/semantic indicator only; shadows are diffuse and hue-tinted
 * (the heavy ink recipe `rgba(23, 32, 38, 0.24)` is retired).
 *
 * Like the timers contract, every allowlist entry carries the reason it may
 * keep the pattern; adding a new ink fill or red control chrome anywhere
 * else fails here on purpose, forcing the author to either restyle it or
 * consciously extend the list with a justification.
 */

// '../' from the file URL pops the filename AND the src/ segment, so this is
// the REPO ROOT (same anchor timersContract.test.ts walks from).
const SRC_ROOT = new URL('../', import.meta.url);

// Bundled/borrowed stylesheets live outside the dialect's jurisdiction.
const PRUNED_DIRS = new Set(['node_modules', 'dist', 'target', 'coverage', '.git']);

function collectCssFiles(dir: URL): URL[] {
  const files: URL[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!PRUNED_DIRS.has(entry.name)) {
        files.push(...collectCssFiles(new URL(`${entry.name}/`, dir)));
      }
      continue;
    }

    if (entry.name.endsWith('.css')) {
      files.push(new URL(entry.name, dir));
    }
  }

  return files;
}

type Violation = { file: string; line: number; text: string };

function findPattern(files: URL[], pattern: RegExp): Violation[] {
  const violations: Violation[] = [];

  for (const file of files) {
    const relative = decodeURIComponent(file.pathname.slice(SRC_ROOT.pathname.length));
    const lines = readText(file).split(/\r?\n/);

    lines.forEach((line: string, index: number) => {
      if (pattern.test(line)) {
        violations.push({ file: relative, line: index + 1, text: line.trim() });
      }
    });
  }

  return violations;
}

/**
 * Ink is text-only in the dialect; a CSS `background:` of ink must be one of
 * the audited decorative/identity surfaces below.
 */
const inkFillAllowlist = [
  {
    // 7px animated "thinking" pulse dot next to the streaming label — a
    // micro-dot in the same family as status dots, not a control.
    path: 'src/agent/ExperimentAgentPanel.module.css',
  },
  {
    // Logo glyph strokes (.logoMark::before/::after) and the aria-hidden
    // .userAvatar identity badge — decorative shell art, never interactive.
    path: 'src/pages/Home.module.css',
  },
];

/**
 * Brand red / brick red may live in CSS only as decorative art or as a
 * semantic indicator paired with an icon or label — never as control chrome.
 */
const brandRedAllowlist = [
  {
    // The --brand / --brand-grad token definitions themselves: consumed by
    // the Login/NotFound marketing gradient art and the chart-series
    // fallback, never applied to a control directly.
    path: 'src/styles/tokens.css',
  },
  {
    // Animated EEG logo art: red strokes/nodes are the brand mark itself.
    path: 'src/homeIntro/LottieEegLogo.module.css',
  },
  {
    // Bipolar-scale red pole stop — semantic endpoint paired with the blue
    // pole and text labels (never the sole meaning carrier).
    path: 'src/mentalScale/scaleUi/scaleUi.module.css',
  },
];

const cssFiles = collectCssFiles(SRC_ROOT);

const inkFills = findPattern(
  cssFiles,
  /background:\s*(?:#2c2218|#172026)\b/,
).filter((v) => !inkFillAllowlist.some((a) => v.file === a.path));

const brandRed = findPattern(
  cssFiles,
  /#b81f1f\b|#df0203\b|rgba\(\s*223,\s*2,\s*3\s*,/,
).filter((v) => !brandRedAllowlist.some((a) => v.file === a.path));

// The retired heavy ink shadow recipe — shadows are diffuse and hue-tinted.
const heavyInkShadows = findPattern(
  cssFiles,
  /box-shadow:[^;]*rgba\(\s*23,\s*32,\s*38,\s*0\.24/,
);

// Round-9 quiet-the-surface: the UI text band snaps to the {11…20} token
// scale, so every raw px font-size in the 10–21 band is a violation (22px+
// display numerals and clamp() heads stay bespoke).
const rawUiFontSizes = findPattern(
  cssFiles,
  /font-size:\s*(?:1[0-9]|2[01])(?:\.\d+)?px/,
);

// Round-9 hairline ladder: 1px ink borders ride --line* tokens instead of
// ad-hoc warm/cool rgba alphas. Semantic tint borders (info/success/…)
// don't match these patterns and stay free-form.
const rawInkHairlines = findPattern(
  cssFiles,
  /border: 1px solid rgba\(\s*(?:44,\s*34,\s*24|23,\s*32,\s*38),/,
);

describe('calm style contract', () => {
  test('the terracotta dialect tokens are defined', () => {
    const tokens = readText(new URL('src/styles/tokens.css', SRC_ROOT));

    expect(tokens).toContain('--calm-primary:');
    expect(tokens).toContain('--calm-primary-hover:');
    expect(tokens).toContain('--calm-primary-rgb:');
  });

  test('the MUI theme primary stays on calm terracotta, not ink or brand red', () => {
    const shell = readText(new URL('src/AppShell.tsx', SRC_ROOT));

    expect(shell).toContain("main: '#c46757'");
    expect(shell).not.toMatch(/main:\s*'#(?:172026|df0203)'/);
    // Contained buttons carry the tokenized terracotta lift (--shadow-control,
    // round-9); the literal rgba recipe is retired everywhere.
    expect(shell).toContain('var(--shadow-control)');
  });

  test('no control is filled with ink (text-only rule)', () => {
    expect(inkFills).toEqual([]);
  });

  test('no control chrome carries brand red (decorative/semantic only)', () => {
    expect(brandRed).toEqual([]);
  });

  test('the heavy ink shadow recipe stays retired', () => {
    expect(heavyInkShadows).toEqual([]);
  });

  test('UI font sizes ride the round-9 type-scale tokens (no raw 10–21px)', () => {
    expect(rawUiFontSizes).toEqual([]);
  });

  test('1px ink borders ride the round-9 hairline tokens (no raw rgba)', () => {
    expect(rawInkHairlines).toEqual([]);
  });
});
