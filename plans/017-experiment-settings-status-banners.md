# 017 — Turn Experiment Settings error/notice/status lines into calm banners

- **Status**: DONE
- **Commit**: a09c7bf
- **Severity**: HIGH
- **Category**: Cohesion & tokens (+ missed opportunity: state-change entrance)
- **Estimated scope**: 2 files (~40 lines)

## Problem

All feedback on the Experiment Settings page is bare colored text — and two
status lines have **no class at all**, so they render as raw default-styled
paragraphs:

```tsx
/* src/pages/home/ExperimentSettings.tsx:81-84 — current */
{!desktop && <p role="status">浏览器预览无法访问串口，请在桌面应用中连接设备。</p>}
{error && <p className={styles.error} role="alert">{error}</p>}
{notice && <p className={styles.notice} role="status">{notice}</p>}
{status.activeRunId && <p role="status">实验 {status.activeRunId} 进行中，设备配置已锁定。</p>}
```

```css
/* src/pages/home/ExperimentSettings.module.css:33-34 — current */
.error { color: var(--danger); }
.notice { color: var(--success); }
```

Every other page in the calm dialect renders these as severity-tinted banners
(muted fill + hairline border + dark ink text) — e.g.
`src/pages/home/EffectEvaluation.module.css:890-898` (`.errorBanner`) and the
MUI Alert re-theme at `:191-229`. Bare `--danger` red text on cream is also
low-contrast and jarring.

## Target

One banner recipe per severity, plus a quiet entrance. All values below match
the system recipes already in use on EffectEvaluation.

```css
/* target */
.error, .notice, .info {
  border-radius: var(--radius-control);
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: 1.55;
  margin: 0;
  padding: 10px 14px;
  animation: bannerEnter 200ms var(--ease-out) backwards;
}
.error { background: rgba(179, 38, 30, .1); border: 1px solid rgba(179, 38, 30, .22); color: var(--danger-ink); }
.notice { background: rgba(34, 125, 84, .1); border: 1px solid rgba(34, 125, 84, .22); color: var(--success); }
.info { background: rgba(45, 113, 184, .08); border: 1px solid rgba(45, 113, 184, .2); color: var(--info); }

@keyframes bannerEnter {
  from { opacity: 0; transform: translate3d(0, 6px, 0); }
  to { opacity: 1; transform: translate3d(0, 0, 0); }
}
```

Delete the old `.error`/`.notice` two-liner.

## Repo conventions to follow

- Exemplar: `src/pages/home/EffectEvaluation.module.css:890-898` — the
  `errorBanner` recipe this plan ports to warm-ink token colors.
- Semantic hexes come from `src/styles/tokens.css` (`--danger-ink: #8d2d25`,
  `--success: #1c6a47`, `--info: #245f9d`).
- Entrances ride `var(--ease-out)` at ≤300ms; `backwards` fill (not `both`)
  releases the end transform — see the rationale comment at
  `src/pages/home/EffectEvaluation.module.css:40-45`.

## Steps

1. **`src/pages/home/ExperimentSettings.module.css`** — replace the `.error`
   / `.notice` rules with the Target block.
2. **Same file** — extend the reduced-motion block (`:39`) with
   `.error, .notice, .info { animation: none; }`.
3. **`src/pages/home/ExperimentSettings.tsx`** — add classes to the two bare
   paragraphs:
   - Line 81: `<p className={styles.info} role="status">浏览器预览无法访问串口…`
   - Line 84: `<p className={styles.info} role="status">实验 {status.activeRunId} 进行中…`
4. **Same file** — the second error surface,
   `<p className={styles.error}>{status.lastError}</p>` (line 102), needs no
   change — it inherits the new banner recipe.
5. **`src/experiment/ExperimentRunHistory.tsx`** — the page-level
   `{error && <p role="alert" className={styles.error}>{error}</p>}` and
   `{notice && <p role="status" className={styles.notice}>{notice}</p>}`
   (lines 31-32) automatically pick up the new recipe; no edits required.

## Boundaries

- Do NOT change `role` attributes or any copy.
- Do NOT introduce a toast/portal system — in-flow banners only.
- Do NOT touch EffectEvaluation's own banner classes.
- If the TSX lines no longer match the excerpts (drift since a09c7bf), STOP
  and report.

## Verification

- **Mechanical**: `pnpm vitest run src/pages/home src/experiment` passes.
- **Feel check**: run the UI:
  - Trigger a failure (send test trigger with no device): the error appears
    as a muted red-tinted banner, not raw red text.
  - Successful library validation shows a green banner; the run-locked line
    shows a blue info banner.
  - In DevTools Animations panel at 10%: the banner rises 6px while fading in.
  - Toggle `prefers-reduced-motion`: the entrance movement is dropped, the
    banner still appears immediately with its tint.
- **Done when**: no feedback on the page renders as unstyled or bare-text.
