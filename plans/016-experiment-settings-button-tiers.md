# 016 — Give Experiment Settings button tiers and a busy spinner

- **Status**: DONE
- **Commit**: a09c7bf
- **Severity**: HIGH
- **Category**: Cohesion & tokens (+ purpose: state indication)
- **Estimated scope**: 2 files (~60 lines)

## Problem

`ExperimentSettings` styles **every** button as a terracotta-filled primary, so
the page has no visual hierarchy: "刷新端口", "断开", "选择文件夹" and the
back link all shout with the same weight as the primary actions.

```css
/* src/pages/home/ExperimentSettings.module.css:15-18 — current */
.page button { font: inherit; cursor: pointer; background: var(--calm-primary); color: white; border: 1px solid transparent; border-radius: var(--radius-control); min-height: 42px; padding: 9px 16px; font-weight: 650; transition: background-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out); }
.page button:hover:enabled { box-shadow: var(--shadow-control); }
.page button:active:enabled { transform: scale(.98); box-shadow: var(--shadow-control-active); }
.page button:hover:enabled { background: var(--calm-primary-hover); }
```

Two related problems:

1. The back button patches around this with an `!important` ghost hack
   (`src/pages/home/ExperimentSettings.module.css:29`):
   ```css
   .backButton { align-self: flex-start; background: transparent !important; color: var(--ink) !important; border-color: var(--line-strong) !important; box-shadow: none !important; }
   ```
2. During serial operations (`busy` in
   `src/pages/home/ExperimentSettings.tsx:28,55`) the buttons only disable —
   the operator gets zero feedback that a connect/test/export is in flight and
   the page feels frozen. The app already has a busy-spinner recipe on
   EffectEvaluation (`src/pages/home/EffectEvaluation.module.css:682-703`).

Also the raw disabled opacity bypasses the token
(`src/pages/home/ExperimentSettings.module.css:20`):
```css
.page button:disabled { opacity: .45; }
```

## Target

Three button tiers matching the EffectEvaluation dialect, plus the shared
busy-spinner recipe. The base `.page button` keeps ONLY the shared geometry;
fill/weight live in tier classes.

```css
/* target — shared base */
.page button { font: inherit; cursor: pointer; border: 1px solid transparent; border-radius: var(--radius-control); min-height: 42px; padding: 9px 16px; font-weight: 650; transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out); }
.page button:active:enabled { transform: scale(.98); }
.page button:disabled { opacity: var(--disabled-opacity); cursor: default; }

/* primary tier (default fill, unchanged recipe) */
.page button { background: var(--calm-primary); color: #fff; }
.page button:hover:enabled { background: var(--calm-primary-hover); box-shadow: var(--shadow-control); }
.page button:active:enabled { box-shadow: var(--shadow-control-active); }

/* ghost/secondary tier */
.ghostButton { background: transparent; color: rgba(44, 34, 24, .82); border-color: var(--line-strong); box-shadow: none; }
.ghostButton:hover:enabled { background: rgba(44, 34, 24, .05); border-color: rgba(44, 34, 24, .42); color: var(--ink); box-shadow: none; }
.ghostButton:active:enabled { transform: scale(.98); box-shadow: none; }

/* busy spinner (same recipe as EffectEvaluation .isBusy) */
.isBusy { align-items: center; gap: 8px; }
.isBusy::before { animation: busySpin 1200ms linear infinite; border: 2px solid currentColor; border-radius: 999px; border-top-color: transparent; content: ""; display: block; flex: 0 0 auto; height: 14px; width: 14px; }
@keyframes busySpin { to { transform: rotate(360deg); } }
```

## Repo conventions to follow

- Motion tokens live in `src/styles/tokens.css` (`--dur-fast: 150ms`,
  `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`, `--disabled-opacity: 0.45`);
  never re-type the raw values.
- Exemplar for the ghost tier: `src/pages/home/EffectEvaluation.module.css:861-888`
  (`.secondaryAction`) — same hover recipe, `white-space: nowrap` optional.
- Exemplar for the spinner: `src/pages/home/EffectEvaluation.module.css:682-703`
  (`.isBusy` + `@keyframes busySpin`).

## Steps

1. **`src/pages/home/ExperimentSettings.module.css`** — restructure the button
   rules as in the Target block: split the base rule from the primary fill,
   add `.ghostButton`, `.isBusy`, `@keyframes busySpin`, and replace
   `opacity: .45` with `var(--disabled-opacity)`.
2. **Same file** — delete the `.backButton` `!important` rule and replace with:
   ```css
   .backButton { align-self: flex-start; }
   ```
   (the ghost class now supplies the styling).
3. **`src/pages/home/ExperimentSettings.tsx`** — add a busy-key so the spinner
   marks the specific action:
   - Replace `const [busy, setBusy] = useState(false);` with
     `const [busyKey, setBusyKey] = useState('');` and
     `const busy = busyKey !== '';`
   - Change `perform` to `perform(key: string, action: () => Promise<void>)`
     with `setBusyKey(key)` in the try prologue and `setBusyKey('')` in the
     `finally`.
   - Update call sites with keys and mark the active one busy:
     - 刷新端口: `perform('refresh', …)`, button
       `className={busyKey === 'refresh' ? styles.isBusy : undefined}` and add
       `ghostButton` class → `className={`${styles.ghostButton}${busyKey === 'refresh' ? ` ${styles.isBusy}` : ''}`}`.
     - 断开 / 连接触发盒: `perform('connect', …)`, same pattern (`isBusy` only,
       stays primary).
     - 发送测试 Trigger: `perform('test', …)`.
     - 选择文件夹: `perform('pickFolder', …)`, add `ghostButton`.
     - 验证并保存素材库: `perform('validateLibrary', …)`.
   - Back button gets `className={`${styles.backButton} ${styles.ghostButton}`}`
     and keeps its existing `onClick`.
4. **`src/pages/home/ExperimentSettings.module.css`** — extend the
   reduced-motion block (`:39`) with:
   ```css
   .isBusy::before { animation: none; }
   ```

## Boundaries

- Do NOT touch `EffectEvaluation` files — they are the reference, not the target.
- Do NOT change `ExperimentRunHistory.tsx` (its busy state gets the same
  treatment in plan 020).
- Do NOT change any button copy or `disabled` conditions.
- If the button rules no longer match the excerpts above (drift since
  a09c7bf), STOP and report.

## Verification

- **Mechanical**: `pnpm vitest run src/pages/home` passes; no TypeScript errors.
- **Feel check**: run the UI (BioSemi settings page):
  - 刷新端口 / 选择文件夹 render as outlined ghost buttons; 连接触发盒 /
    发送测试 Trigger stay terracotta primary.
  - Click 发送测试 Trigger with the device absent (it errors) — the spinner
    shows inside the button while in flight, then the banner appears.
  - Spam-click 刷新端口: pressed feedback is instant, no animation restarts
    from zero.
  - In DevTools Animations panel at 10%: the spinner is a rotating ring, the
    pressed scale is 0.98.
  - Toggle `prefers-reduced-motion`: spinner stops, hover color feedback stays.
- **Done when**: no `!important` remains in the stylesheet; every button is
  visually tier-assignable at a glance; busy actions show the spinner.
