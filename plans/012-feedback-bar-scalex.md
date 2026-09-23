# 012 — Replace the feedback bar's width transition with scaleX

- **Status**: DONE (executed 2026-09-23 on commit 4f567de)
- **Commit**: 4f567de
- **Severity**: LOW
- **Category**: Performance
- **Estimated scope**: 1 css file, 1 tsx file

## Problem

The trial feedback bar animates `width` — the only animated layout property
in the codebase — on the same screen where uPlot EEG charts render at ~30 fps.
400 ms of layout+paint per trial feedback, for what a transform does for
free.

`src/eeg/paradigm/ParadigmSession.module.css:1002-1007` — current:

```css
.feedbackBarFill {
  border-radius: 999px;
  display: block;
  height: 100%;
  transition: width 400ms var(--ease-out);
}
```

Widths are set inline per trial — `src/eeg/paradigm/TrialStageRenderer.tsx:231-234`
and `:241-244`:

```tsx
          <span
            className={`${styles.feedbackBarFill} ${styles.feedbackBarFillBaseline}`}
            style={{ width: toPercent(baselineScore) }}
          />
```

```tsx
          <span
            className={`${styles.feedbackBarFill} ${styles.feedbackBarFillTarget}`}
            style={{ width: toPercent(regulationScore) }}
          />
```

## Target

The fill element is always full-width and reveals via `transform: scaleX()`
anchored left; the transition moves to `transform`. Compositor-only, no
layout.

## Repo conventions to follow

- Transform/opacity-only rule is already the norm repo-wide (zero other
  animated layout properties); this closes the last gap.
- `toPercent`/score math in `TrialStageRenderer.tsx:222-224` is unchanged.

## Steps

1. `ParadigmSession.module.css` `.feedbackBarFill`:

   ```css
   .feedbackBarFill {
     border-radius: 999px;
     display: block;
     height: 100%;
     transform-origin: 0 50%;
     transition: transform 400ms var(--ease-out);
     width: 100%;
   }
   ```

2. `TrialStageRenderer.tsx` — both fills change from width to scaleX
   (scores are already clamped 0-1 by `toPercent`'s math, so derive the raw
   scalar for the transform):

   ```tsx
            style={{ transform: `scaleX(${Math.min(1, Math.max(0, baselineScore))})` }}
   ```

   and

   ```tsx
            style={{ transform: `scaleX(${Math.min(1, Math.max(0, regulationScore))})` }}
   ```

3. Check the reduced-motion block in `ParadigmSession.module.css`: if it
   lists `.feedbackBarFill` under `transition: none`, the entry stays valid
   (transform transition removed → instant). If it does not list it, add
   `.feedbackBarFill { transition: none; }`.

## Boundaries

- Do NOT touch the bar TRACK (`feedbackBarTrack`) or the value labels.
- Do NOT change the 400 ms duration or easing.
- If the excerpts drift, STOP and report.

## Verification

- **Mechanical**: `pnpm test` (timers contract untouched), `pnpm build`.
- **Feel check**: run a trial: the feedback bars still fill left-to-right
  over 400 ms and look identical; the numeric labels are unchanged. In
  DevTools Performance panel, a trial reveal records no layout Recalculate
  Style thrash from the bars (previously each frame relaid out).
- Toggle `prefers-reduced-motion`: bars jump to final width instantly.
- **Done when**: `grep -n "transition: width" src -r` returns nothing.
