# 013 — Coalesce the matter-world ResizeObserver

- **Status**: DONE (executed 2026-09-23 on commit 4f567de)
- **Commit**: 4f567de
- **Severity**: LOW
- **Category**: Performance
- **Estimated scope**: 1 ts file

## Problem

`src/components/matterBackground.ts:421-422` rebuilds the entire physics
world on every resize observation, unthrottled:

```ts
  const resizeObserver = new ResizeObserver(buildWorld);
  resizeObserver.observe(host);
```

`buildWorld` (lines 172-219) reallocates the canvas at devicePixelRatio,
calls `Render.setPixelRatio`, clears the world, rebuilds 36 wall bodies,
re-lays out the title, and respawns balls. During a window drag-resize this
fires per frame, each time doing canvas reallocation + world reconstruction
while the render loop is running. Every other observer in the repo
(`EegWaveformPanel.tsx:177-199`, `EffectResultChartView.tsx:46-56`,
`GlobalMentalScalePanel.tsx:108-118`) coalesces via rAF.

## Target

rAF-coalesced rebuild: at most one `buildWorld()` per animation frame during
a resize storm, with the pending frame cancelled on teardown.

## Repo conventions to follow

- Coalescing exemplar: `EegWaveformPanel.tsx:177-199` (ResizeObserver →
  rAF → work, with cleanup). Imitate its shape.

## Steps

1. In `src/components/matterBackground.ts`, replace lines 421-422 with:

   ```ts
    // Drag-resize fires an observation per frame; coalesce to one world
    // rebuild per animation frame (same shape as EegWaveformPanel's
    // resize handling) instead of reallocating canvas + 36 bodies each fire.
    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        buildWorld();
      });
    });
    resizeObserver.observe(host);
   ```

2. In the same function's teardown (the cleanup that disconnects the
   observers — located near lines 430-442; find the block that calls
   `resizeObserver.disconnect()`), add before/with the disconnect:

   ```ts
      if (resizeFrame) {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = 0;
      }
   ```

   Keep the declaration (`let resizeFrame = 0`) and its cleanup in the same
   closure scope — both live inside the setup function that also defines
   `buildWorld` and registers the observers.

## Boundaries

- Do NOT change `buildWorld` itself, the render loop, the physics stepping,
  or the IntersectionObserver/visibilitychange wiring.
- Do NOT debounce with a timer — rAF coalescing only (repo convention).
- If the teardown block drifts from the description, STOP and report what
  you found instead of guessing.

## Verification

- **Mechanical**: `pnpm test`, `pnpm build`.
- **Feel check**: launch the app with the matter background visible, drag
  the window edge to resize continuously for ~3 s: no stutter spikes, balls
  respawn once the resize settles, no stuck black canvas. Cancel behavior:
  resize and immediately unmount the background (navigate away mid-drag) —
  no post-teardown rebuild errors in console.
- **Done when**: a 3 s drag-resize triggers a handful of world rebuilds
  (bounded by frames where work actually ran), not one per observation.
