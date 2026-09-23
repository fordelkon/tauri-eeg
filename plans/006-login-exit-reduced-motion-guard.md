# 006 — Fix the defeated reduced-motion guard on the login exit animation

- **Status**: DONE (executed 2026-09-23 on commit 4f567de)
- **Commit**: 4f567de
- **Severity**: MEDIUM
- **Category**: Accessibility + Performance
- **Estimated scope**: 1 css file (guard fix), optional 1 css file follow-up

## Problem

`loginSceneExpand` is the heaviest single animation in the app: 940 ms of
full-viewport `width`/`height`/`left`/`top`/`border-radius` keyframes
(layout+paint every frame). Its reduced-motion guard is dead code — defeated
by specificity:

`src/pages/Login.module.css:41-54` (specificity 0,3,0):

```css
.container.isExiting .leftPanel {
  animation: loginSceneExpand 940ms cubic-bezier(0.76, 0, 0.24, 1) forwards;
  border-radius: 0;
  box-shadow: none;
  height: var(--exit-height, 100vh);
  left: var(--exit-left, 0);
  min-height: 0;
  position: fixed;
  top: var(--exit-top, 0);
  transform-origin: 50% 50%;
  width: var(--exit-width, 100vw);
  will-change: inset, width, height, border-radius;
  z-index: 4;
}
```

`src/pages/Login.module.css:471-478` (the guard — `.leftPanel` alone is
0,1,0, so `animation: none` NEVER applies while `.isExiting` is set):

```css
@media (prefers-reduced-motion: reduce) {
  .leftPanel,
  .rightPanel,
  .formPanel {
    animation: none;
    opacity: 1;
    transform: none;
  }
```

The guard only appears to work because `Login.tsx:241` navigates after
`reducedMotion ? 0 : 940` ms — any future change to that timeout silently
reintroduces the layout animation for reduced-motion users.

## Target

The guard wins regardless of `.isExiting`: the reduced-motion block's
selectors are raised to match/exceed the exit rule's specificity. The exit
becomes an instant jump-cut for reduced-motion users (content simply appears
full-screen — correct reduced-motion behavior). The layout-property
keyframes themselves stay (full rework to `transform: scale()` is a larger
visual change — see Boundaries).

## Repo conventions to follow

- Keep the guard block where it is (all reduced-motion handling for this
  file lives in the one block at lines 471+).

## Steps

1. In `Login.module.css`'s reduced-motion block, change the first selector
   list (lines 472-474) from:

   ```css
   .leftPanel,
   .rightPanel,
   .formPanel {
   ```

   to:

   ```css
   .leftPanel,
   .container.isExiting .leftPanel,
   .rightPanel,
   .container.isExiting .rightPanel,
   .formPanel {
   ```

   (`0,3,0` ties with the exit rule; later-in-file wins, and this block is
   later in the file than line 41. This also covers `.rightPanel`, whose
   exit rule at line 56-58 has the same specificity problem.)
2. In `.container.isExiting .leftPanel` (line 52), delete the line
   `will-change: inset, width, height, border-radius;` — promoting layout
   properties does not avoid the per-frame reflow and the hint is harmful
   clutter.

## Boundaries

- Do NOT rework `loginSceneExpand` keyframes to transform-based motion in
  this plan — that changes the login exit's visual shape and deserves its
  own design pass. File it as a follow-up if desired.
- Do NOT touch `Login.tsx` (the `reducedMotion ? 0 : 940` timeout stays as
  the belt to this brace).
- Do NOT touch the `:hover`/`:active` parts of the reduced-motion block
  (plan 005's Login step covers the hover reset).
- If the block drifts from the excerpts, STOP and report.

## Verification

- **Mechanical**: `pnpm test`, `pnpm build`.
- **Feel check**: toggle `prefers-reduced-motion: reduce`, log in: the login
  scene jumps instantly to the full-screen state with no 940 ms expansion;
  the form panel fades/appears per its existing reduced-motion rules.
  Untoggle and log in again: the cinematic expansion still plays.
- **Done when**: with reduced motion on, DevTools shows no running
  `loginSceneExpand` animation during the exit.
