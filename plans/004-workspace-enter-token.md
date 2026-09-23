# 004 — Tokenize and shorten the workspace entrance

- **Status**: DONE (executed 2026-09-23 on commit 4f567de)
- **Commit**: 4f567de
- **Severity**: MEDIUM
- **Category**: Easing & duration + Cohesion
- **Estimated scope**: 5 css files, 1 tokens file

## Problem

The route-level workspace entrance runs 460 ms on every navigation (over the
300 ms UI budget), and its keyframes are hand-copied in four CSS modules. The
Home shell content entrance adds a fifth hardcoded value (520 ms, once per app
launch).

The four verbatim copies of the keyframes (note: VideoRegulation's copy is
missing `scale(0.99)`):

`src/pages/home/EegAcquisition.module.css:5`:

```css
.workspace {
  animation: workspaceEnter 460ms var(--ease-out) both;
```

`src/pages/home/EffectEvaluation.module.css:46` (uses `backwards`, with a
load-bearing comment about the fixed-position modal — see Boundaries):

```css
  animation: workspaceEnter 460ms var(--ease-out) backwards;
```

`src/pages/home/MusicRegulation.module.css:2` and
`src/pages/home/VideoRegulation.module.css:2`:

```css
  animation: workspaceEnter 460ms var(--ease-out) both;
```

Keyframes as defined in `EegAcquisition.module.css:21-31`,
`MusicRegulation.module.css:9-19`, `EffectEvaluation.module.css:60-70`:

```css
@keyframes workspaceEnter {
  from {
    opacity: 0;
    transform: translate3d(0, 18px, 0) scale(0.99);
  }

  to {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
}
```

`VideoRegulation.module.css:8-18` — the odd one:

```css
@keyframes workspaceEnter {
  from {
    opacity: 0;
    transform: translate3d(0, 18px, 0);
  }

  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
```

`src/pages/Home.module.css:594-596`:

```css
  transition:
    opacity 520ms var(--ease-out),
    transform 520ms var(--ease-out);
```

## Target

- New token in `src/styles/tokens.css` (Motion section):
  `--dur-enter: 300ms;` with comment
  `/* Route/workspace entrance: at the top edge of the UI budget — the page must feel ready, not staged. */`
- All four `workspaceEnter` animations: `460ms` → `var(--dur-enter)`.
- All four keyframe definitions aligned to the `scale(0.99)` variant
  (VideoRegulation gains `scale(0.99)` / `scale(1)`).
- `Home.module.css` `.content` transition: both `520ms` → `var(--dur-enter)`.
- Per-module keyframes STAY in place (CSS Modules scope keyframe names per
  module by design; moving them to a global sheet would require
  `:global()` gymnastics for no real gain — the consolidation deliverable is
  the shared duration + identical values).

## Repo conventions to follow

- Motion tokens live in `src/styles/tokens.css` under `/* Motion */`.
- The `backwards` vs `both` fill distinction is load-bearing: keep each file's
  current fill mode exactly (`EffectEvaluation` must stay `backwards` — its
  comment at lines 40-45 explains a fixed-position modal bug).

## Steps

1. `src/styles/tokens.css`: add `--dur-enter: 300ms;` after `--dur-med`.
2. `EegAcquisition.module.css:5`, `MusicRegulation.module.css:2`,
   `VideoRegulation.module.css:2`: `460ms` → `var(--dur-enter)` (fill mode
   unchanged: `both`).
3. `EffectEvaluation.module.css:46`: `460ms` → `var(--dur-enter)` (fill mode
   unchanged: `backwards`).
4. `VideoRegulation.module.css` keyframes: add `scale(0.99)` to the `from`
   transform (`translate3d(0, 18px, 0) scale(0.99)`) and `scale(1)` to the
   `to` transform.
5. `Home.module.css:594-596`: both `520ms` → `var(--dur-enter)`.

## Boundaries

- Do NOT change fill modes, keyframe names, or any comment.
- Do NOT touch the intro overlay, Login, or NotFound animations (rare/first-run
  art is duration-exempt).
- If a line drifts from the excerpts, STOP and report.

## Verification

- **Mechanical**: `pnpm test`, `pnpm build`.
- **Feel check**: navigate 首页 → 音乐调控 → 效果评价 → back: each page enters
  with a crisp 300 ms rise (noticeably snappier than before but not abrupt);
  the embedded mental-scale dialog in 效果评价 still positions correctly
  (the `backwards` fill bug stays fixed).
- Toggle `prefers-reduced-motion`: entrances drop to instant.
- **Done when**: `grep -rn "460ms" src/` and `grep -rn "520ms" src/` return
  no matches in src/pages.

## Execution note (2026-09-23)

Executed as written. One VideoRegulation nuance vs. the audit excerpt: its
`from` keyframe already carried `scale(0.99)` (only the `to` transform lacked
`scale(1)`); aligned accordingly. The "Done when" grep's `520ms` term
over-reached slightly: `Login.module.css:56` (`loginFormExit 520ms`) and
`NotFound.module.css:80` remain by design — both are rare/first-run art that
this plan's Boundaries explicitly exempt. `src/pages` workspace entrances
are clean.
