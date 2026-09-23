# 002 — Align the Home drawer choreography on one drawer recipe

- **Status**: DONE (executed 2026-09-23 on commit 4f567de)
- **Commit**: 4f567de
- **Severity**: MEDIUM (was flagged HIGH; the close truncation is feel-breaking but confined to the drawer)
- **Category**: Interruptibility + Easing/duration + Physicality
- **Estimated scope**: 1 css file, 1 tokens file

## Problem

The Home drawer's three nested surfaces run three different hardcoded
durations, so closing the drawer truncates its own slide:

- `.menuLayer` (the fixed wrapper) fades out in 220 ms and then flips
  `visibility: hidden` — while the sidebar is only ~halfway through its
  420 ms slide. `src/pages/Home.module.css:42-44` — current:

  ```css
  transition:
    opacity var(--dur-med) var(--ease-out),
    visibility 0s linear var(--dur-med);
  ```

- `.sidebar` slides 420 ms (`Home.module.css:65-66`):

  ```css
  transform: translateX(-100%);
  transition:
    transform 420ms var(--ease-out);
  ```

- `.sidebarOverlay` fades 380 ms (`Home.module.css:225-228`):

  ```css
  transition:
    background 380ms var(--ease-out),
    opacity 380ms var(--ease-out),
    visibility 0s var(--ease-out) 380ms;
  ```

Additionally the decorative `.menuVisual` panel animates with restart-on-open
keyframes (`Home.module.css:88-91`):

```css
.menuLayer.isOpen .menuVisual {
  animation: menuVisualIn 620ms var(--ease-out) both;
  display: block;
}
```

and `Home.module.css:1108-1116`:

```css
@keyframes menuVisualIn {
  from {
    transform: translateX(100%);
  }

  to {
    transform: translateX(0);
  }
}
```

Reopening the drawer mid-close restarts that keyframe from zero, and it has no
exit at all.

## Target

One drawer recipe on tokens, all four surfaces ending together:

- New tokens in `src/styles/tokens.css` (Motion section, after `--ease-out`):

  ```css
  /* Drawer choreography: iOS-like curve; every drawer surface (sidebar,
     layer fade, scrim, visual) shares one duration so close never
     truncates slide. */
  --dur-drawer: 360ms;
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  ```

- `.sidebar`: `transition: transform var(--dur-drawer) var(--ease-drawer);`
- `.menuLayer` and `.menuLayer.isOpen`: opacity at `var(--dur-drawer)`
  `var(--ease-drawer)`, with the `visibility` delay matching
  `var(--dur-drawer)`.
- `.sidebarOverlay` (both states): background/opacity at `var(--dur-drawer)`
  `var(--ease-drawer)`, `visibility 0s var(--ease-drawer) var(--dur-drawer)`
  in the closed state.
- `.menuVisual`: replace the keyframes with a retargetable transition, same
  recipe as `.sidebar`:

  ```css
  .menuVisual {
    /* existing background/display/min-height/overflow/position stay */
    transform: translateX(100%);
    transition: transform var(--dur-drawer) var(--ease-drawer);
  }

  .menuLayer.isOpen .menuVisual {
    display: block;
    transform: translateX(0);
  }
  ```

  Delete the `@keyframes menuVisualIn` block and the `animation:` line.
  Note: `.menuVisual` currently has `display: none` at rest — keep that; the
  `translateX(100%)` resting transform is inert while hidden.

## Repo conventions to follow

- Tokens live in `src/styles/tokens.css` under the `/* Motion */` comment
  block (`--dur-fast`, `--dur-med`, `--ease-out`). Add the two new tokens
  there with a short rationale comment, exactly like the existing ones.
- The drawer's reduced-motion handling lives in the
  `@media (prefers-reduced-motion: reduce)` block at
  `Home.module.css:1023-1041` — it already sets `animation: none` and
  `transition: none` on `.menuLayer, .sidebar, .sidebarOverlay, .menuVisual`.
  Verify `.menuVisual` is still listed after your edit (it is listed twice —
  keep both lists intact).

## Steps

1. `src/styles/tokens.css`: add `--dur-drawer` and `--ease-drawer` per the
   Target block above.
2. `src/pages/Home.module.css` line 65-66: sidebar transition →
   `transform var(--dur-drawer) var(--ease-drawer);`
3. `.menuLayer` (lines 42-44) and `.menuLayer.isOpen` (lines 52-54): opacity
   transitions → `var(--dur-drawer) var(--ease-drawer)`; the closed-state
   `visibility 0s linear var(--dur-med)` → `visibility 0s linear var(--dur-drawer)`.
4. `.sidebarOverlay` (lines 225-228 and 237-240): all `380ms` →
   `var(--dur-drawer)`, all `var(--ease-out)` on these transitions →
   `var(--ease-drawer)`.
5. `.menuVisual`: add `transform: translateX(100%);` and
   `transition: transform var(--dur-drawer) var(--ease-drawer);` to the base
   rule; in `.menuLayer.isOpen .menuVisual` replace the `animation:` line
   with `transform: translateX(0);` (keep `display: block;`).
6. Delete `@keyframes menuVisualIn` (lines 1108-1116).

## Boundaries

- Do NOT change the open/close state logic in `Home.tsx`.
- Do NOT touch `.mobileMenuButton`, `.navItem`, `.content` transitions.
- Do NOT change the `@media (max-width: 860px)` block (mobile hides
  `.menuVisual`).
- If line contents drift from the excerpts above, STOP and report.

## Verification

- **Mechanical**: `pnpm test` (calm style contract must stay green),
  `pnpm build`.
- **Feel check**: open the drawer and close it:
  - sidebar slide, scrim fade, and layer fade all settle together — the
    sidebar never vanishes mid-slide;
  - close the drawer and re-open it halfway through the close: the visual
    panel glides from its current position instead of snapping back to the
    right edge;
  - the visual panel now also slides OUT with the drawer (it previously
    vanished).
- In DevTools at 10% speed: all four surfaces start and stop on the same
  frames.
- Toggle `prefers-reduced-motion`: drawer opens/closes instantly, no motion.
- **Done when**: no surface outlives another; mid-close reopen retargets.
