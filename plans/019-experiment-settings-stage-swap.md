# 019 — Ease the Experiment Settings ↔ Paradigm stage swap

- **Status**: DONE
- **Commit**: a09c7bf
- **Severity**: MEDIUM
- **Category**: Missed opportunities (state changes that teleport)
- **Estimated scope**: 2 files (~20 lines)

## Problem

Switching between the "实验设置" and "逐试次范式" stages
(`src/pages/home/ExperimentSettings.tsx:20` `stage` state; the two return
branches at :57-74 and :76-144) hard-cuts: the `<main>` element persists, so
the existing `pageEnter` animation never replays and the entire page body
teleports between two different layouts with zero transition.

The app already has the exact recipe for this: EffectEvaluation keys its stage
body by step and replays a short rise
(`src/pages/home/EffectEvaluation.tsx:473` → `<div key={state.step}
className={styles.stageSwap}>`, CSS at
`src/pages/home/EffectEvaluation.module.css:2459-2475`).

## Target

```css
/* src/pages/home/ExperimentSettings.module.css — target */
.stageSwap { animation: stageSwapIn 200ms var(--ease-out) backwards; display: grid; gap: 18px; }
@keyframes stageSwapIn { from { opacity: 0; transform: translate3d(0, 8px, 0); } to { opacity: 1; transform: translate3d(0, 0, 0); } }
```

Reduced-motion: add `.stageSwap { animation: none; }` to the existing
reduced-motion block.

## Repo conventions to follow

- Exemplar: `src/pages/home/EffectEvaluation.module.css:2455-2475` — same
  keyframe shape, same 200ms/`var(--ease-out)`/`backwards` recipe.
- `backwards` (not `both`) so the end transform is released — see the
  fixed-positioning trap documented at
  EffectEvaluation.module.css:40-45.
- Values: `src/styles/tokens.css` (`--dur-fast: 150ms`, `--dur-med: 220ms`;
  200ms sits between them and matches the existing stageSwap — do not
  introduce a new duration token).

## Steps

1. **`src/pages/home/ExperimentSettings.tsx`** — in BOTH return branches,
   wrap the content below the shared `<main className={styles.page}>` in a
   keyed wrapper:
   - Paradigm branch (:58-73): everything inside `<main>` becomes
     ```tsx
     <main className={styles.page}>
       <div key="paradigm" className={styles.stageSwap}>
         {/* pageHeader, stepRail, ParadigmSessionPanel, backButton as-is */}
       </div>
     </main>
     ```
   - Settings branch (:77-144): everything inside `<main>` becomes
     ```tsx
     <main className={styles.page}>
       <div key="settings" className={styles.stageSwap}>
         {/* pageHeader, banners, sections, pageNav, ExperimentRunHistory as-is */}
       </div>
     </main>
     ```
   No other JSX changes; the scroll-to-top calls in the two navigation
   buttons stay untouched.
2. **`src/pages/home/ExperimentSettings.module.css`** — append the Target
   block after the `.page` rules, and add `.stageSwap { animation: none; }`
   inside the reduced-motion media query at :39.

## Boundaries

- Do NOT change the `pageEnter` animation on `.page` (module.css:1) — it
  still covers the route entrance.
- Do NOT unmount/remount `ParadigmSessionPanel` on its own state changes —
  the key is the stage string only.
- Do NOT add a transition for the *content within* a stage (section mounts,
  history expand) — out of scope.
- If the TSX structure no longer matches (drift since a09c7bf), STOP and
  report.

## Verification

- **Mechanical**: `pnpm vitest run src/pages/home` passes.
- **Feel check**: run the UI:
  - Click 下一步：逐试次范式 and ← 返回实验设置 repeatedly: each swap is a
    short 8px rise + fade, never a hard cut, never a lingering transform
    (click a button immediately after a swap — nothing stays offset).
  - In DevTools Animations panel at 10%: exactly one 200ms rise per swap; the
    two stages swap cleanly with no double-exposure.
  - Toggle `prefers-reduced-motion`: the swap is instant, content still
    appears.
- **Done when**: both stage directions animate once per change and spamming
  the toggle never leaves a stale transform.
