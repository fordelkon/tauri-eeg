# 011 — Let the Home logo rest after one cycle

- **Status**: DONE (executed 2026-09-23 on commit 4f567de)
- **Commit**: 4f567de
- **Severity**: LOW (product taste decision — approved by the user)
- **Category**: Purpose & frequency
- **Estimated scope**: 1 tsx file, 1 tsx consumer

## Problem

The Home overview's entire content is a 9-layer infinitely looping logo
animation (`LottieEegLogo` with `loop = true` default plus nine CSS
`... infinite` keyframe layers). `/home` is returned to many times a day; the
only purpose answer for permanent idle motion is "it looks cool", which the
frequency table rejects (100+ views/day → no perpetual animation).

Component default: `src/homeIntro/LottieEegLogo.tsx:12-16`:

```tsx
export default function LottieEegLogo({
  className,
  loop = true,
  title = 'EEG emotion regulation animated logo',
}: LottieEegLogoProps) {
```

Consumer: `src/pages/home/HomeOverview.tsx:8`:

```tsx
      <LottieEegLogo className={styles.homeLogoMark} />
```

The component already pauses both the lottie player AND the CSS keyframe
layers via the `data-paused` attribute (`LottieEegLogo.tsx:55-73` +
`LottieEegLogo.module.css:111-123`) — the rest state hooks already exist.

## Target

On the Home overview the logo plays exactly one full cycle, then rests
(completely static: lottie stopped, CSS loops paused). The first-run intro
overlay usage (`HomeIntroLogo`) keeps looping — it is rare/first-run and
keeps `loop = true`.

## Repo conventions to follow

- The visibility/visibilitychange/intersection sync pattern in
  `LottieEegLogo.tsx:51-91` is already complete — extend it, don't replace it.

## Steps

1. `HomeOverview.tsx` line 8:

   ```tsx
      <LottieEegLogo className={styles.homeLogoMark} loop={false} />
   ```

2. `LottieEegLogo.tsx` — inside the lazy-load effect, add a completion latch.
   Change the local state block (lines 27-53 region) so that:

   ```tsx
      let cancelled = false;
      let animation: AnimationItem | null = null;
      let detachVisibilitySync: (() => void) | null = null;
      let hasCompleted = false;
   ```

   extend the play predicate:

   ```tsx
      const syncPlayback = () => {
        const shouldPlay = !prefersReducedMotion && isVisible && isPageVisible && !hasCompleted;
        if (shouldPlay === playing) return;
        playing = shouldPlay;
        if (shouldPlay) {
          animation?.play();
        } else {
          animation?.pause();
        }
        syncPausedState();
      };
   ```

   and register the complete listener right after `loadAnimation` (next to
   the observer wiring):

   ```tsx
      // loop={false} consumers rest after one cycle: latch completion so
      // visibility changes never resurrect the idle animation, and pause
      // the CSS keyframe layers with the same data-paused hook.
      animation.addEventListener('complete', () => {
        hasCompleted = true;
        playing = false;
        syncPausedState();
      });
   ```

   (`AnimationItem` in lottie-web's typings exposes `addEventListener`; if
   TS complains, cast through `animation.addEventListener('complete' as never, ...)` is NOT
   acceptable — instead widen the local type to
   `AnimationItem & { addEventListener: (event: string, cb: () => void) => void }`.)

3. Do NOT change the reduced-motion path — `autoplay: !prefersReducedMotion`
   already renders the resting logo, and `hasCompleted` starts `false` but
   the predicate's `!prefersReducedMotion` term keeps it paused.

## Boundaries

- Do NOT change `HomeIntroLogo`'s usage (intro overlay keeps looping).
- Do NOT touch the CSS keyframe layers or the `data-paused` mechanism.
- Do NOT add a fade-out "settle" animation — rest means rest.
- If the effect body drifts from the excerpt, STOP and report.

## Verification

- **Mechanical**: `pnpm test`, `pnpm build`.
- **Feel check**: navigate to 首页: the logo plays one full cycle (~2.4 s)
  and comes to a complete rest; switch to another app window and back — it
  stays at rest; navigate away to a module and back to 首页 — a fresh mount
  plays one cycle again (acceptable: a per-visit single play, not perpetual
  motion). The login intro overlay still loops as before.
- **Done when**: no infinite animation runs on the Home overview after the
  first cycle.
