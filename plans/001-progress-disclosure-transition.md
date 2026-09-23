# 001 — Give the wizard progress disclosure a retargetable expand/collapse

- **Status**: DONE (executed 2026-09-23 on commit 4f567de)
- **Commit**: 4f567de
- **Severity**: HIGH
- **Category**: Interruptibility + Missed opportunity
- **Estimated scope**: 1 tsx file, 1 css file

## Problem

The wizard progress disclosure mounts/unmounts its panel with a hard conditional
render — no transition in either direction. It is the most rapidly retargeted
expand/collapse in the app: it auto-blooms on every step change and a 2.2 s
timer folds it again, and the scale dialog force-collapses it. The timer fold
can yank the panel shut mid-read with zero motion explaining it.

`src/pages/home/EffectProgressDisclosure.tsx:152-157` — current:

```tsx
      {isOpen ? (
        <div id="effect-progress-panel" className={styles.progressPanel}>
          <EffectTimeline nodes={nodes} onStationClick={onStationClick} />
          <EffectDoneBand doneNodes={doneNodes} onChipClick={onChipClick} />
        </div>
      ) : null}
```

`src/pages/home/EffectEvaluation.module.css:1939-1944` — current (no
transition/animation at all):

```css
.progressPanel {
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid var(--ee-line);
  border-radius: var(--ee-radius-control);
  padding: 4px 12px 8px;
}
```

## Target

Wrap the panel in MUI `Collapse` so both directions retarget mid-motion
(keyframes would restart from zero — this must be a transition-based reveal).
Reveal duration 220 ms (`--dur-med`); 0 ms under `prefers-reduced-motion`.

## Repo conventions to follow

- The repo already uses MUI `Collapse` for an expandable region:
  `src/pages/home/EffectHistoryPanel.tsx:4` (import) and `:168`
  (`<Collapse in={isExpanded} timeout={collapseTimeout} unmountOnExit>`).
  Imitate that usage.
- Reduced-motion detection pattern (one-shot `matchMedia`, no listener):
  `src/homeIntro/LottieEegLogo.tsx:38`
  `const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;`
- Easing/duration tokens live in `src/styles/tokens.css`
  (`--dur-med: 220ms; --ease-out: cubic-bezier(0.16, 1, 0.3, 1);`).

## Steps

1. In `src/pages/home/EffectProgressDisclosure.tsx`, add the import at the top
   with the other MUI imports:

   ```tsx
   import Collapse from '@mui/material/Collapse';
   ```

2. Inside the component body, just above the `return`, compute the collapse
   timeout once (module-scope constant + one-shot media query, mirroring
   `LottieEegLogo.tsx:38`):

   ```tsx
   const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
   ```

   (Place this line inside the component render — it is a cheap one-shot
   query — or hoist it to module scope beside `ANNOUNCE_MS` as
   `const COLLAPSE_TIMEOUT_MS = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;`
   Either is acceptable; do not add a listener or state.)

3. Replace the conditional render at lines 152-157 with:

   ```tsx
      <Collapse in={isOpen} timeout={prefersReducedMotion ? 0 : 220} unmountOnExit>
        <div id="effect-progress-panel" className={styles.progressPanel}>
          <EffectTimeline nodes={nodes} onStationClick={onStationClick} />
          <EffectDoneBand doneNodes={doneNodes} onChipClick={onChipClick} />
        </div>
      </Collapse>
   ```

   The `id` and the inner className stay on the inner div so
   `aria-controls="effect-progress-panel"` on the toggle button (line 125)
   keeps working. `unmountOnExit` preserves the current mount/unmount
   semantics.

4. Do NOT add any CSS. `Collapse` animates the wrapper's height; the existing
   `.progressPanel` styles are unchanged.

## Boundaries

- Do NOT touch the announce/pin/timer logic (`ANNOUNCE_MS`, `isPinnedRef`,
  `handleToggle`, the two `useEffect`s) — only the render block changes.
- Do NOT restyle `.progressPanel` or the timeline.
- Do NOT add new dependencies (`@mui/material/Collapse` is already a
  dependency used by `EffectHistoryPanel.tsx`).
- If the code at lines 152-157 no longer matches the excerpt above (drift
  since commit 4f567de), STOP and report instead of improvising.

## Verification

- **Mechanical**: `pnpm test` passes (including
  `EffectProgressDisclosure.contract.test.ts` if present — if a contract test
  asserts the old conditional-render shape, update its expectation to the
  `Collapse` wrapper and note it in the PR description); `pnpm build`
  compiles.
- **Feel check**: run the app (`pnpm tauri dev` or `pnpm dev`), open
  效果评价, advance a wizard step:
  - the panel blooms open with a smooth height+opacity reveal, not a jump;
  - when the 2.2 s announce timer fires, the panel folds smoothly — mid-fold,
    click the toggle: the fold retargets from the current height instead of
    restarting;
  - force-collapse via the scale dialog: same smooth fold.
- In DevTools Animations panel at 10% speed, confirm the reveal eases out
  (fast start, gentle settle).
- Toggle `prefers-reduced-motion` (Rendering panel): the panel appears/
  disappears instantly (0 ms) with no height animation.
- **Done when**: opening, timer-folding, and dialog-force-folding all animate
  and are interruptible mid-motion.

## Execution note (2026-09-23)

Executed as written. One anticipated deviation: the contract test
`EffectProgressDisclosure.contract.test.ts` asserted the old conditional
render (`isOpen ? (<div id="effect-progress-panel"`); its expectation was
updated per this plan's Mechanical section to pin the new invariant
(`<Collapse in={isOpen}` + `unmountOnExit`). 485/485 tests green.
