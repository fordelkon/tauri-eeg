# 015 — Consolidate hand-typed curves onto tokens; fix press-feedback duration

- **Status**: DONE (executed 2026-09-23 on commit 4f567de)
- **Commit**: 4f567de
- **Severity**: LOW
- **Category**: Cohesion & tokens + Easing & duration
- **Estimated scope**: 4 css files

## Problem

Four hand-typed literal copies of the `--ease-out` curve, one accidental
`ease-in` curve on an exit, one bare `ease-out` keyword, and the floating
menu button's press feedback running at press-unfriendly 220 ms:

- `src/homeIntro/HomeIntroLogo.module.css:3`:
  `animation: overlayIn 320ms cubic-bezier(0.16, 1, 0.3, 1) both;`
- `src/homeIntro/HomeIntroLogo.module.css:46`:
  `animation: logoIn 700ms cubic-bezier(0.16, 1, 0.3, 1) both;`
- `src/homeIntro/HomeIntroLogo.module.css:32`:
  `animation: overlayOut 480ms cubic-bezier(0.7, 0, 0.84, 0) both;` —
  `0.7, 0, 0.84, 0` IS the built-in `ease-in` curve, hand-typed. For an
  overlay EXIT a fast-leave curve is correct; the problem is that it is an
  unnamed accident, not a named decision.
- `src/homeIntro/LottieEegLogo.module.css:59`:
  `animation: waveFlow 2200ms cubic-bezier(0.16, 1, 0.3, 1) infinite;`
- `src/pages/Login.module.css:57`:
  `animation: loginFormExit 520ms ease-out forwards;` — the only motion in
  the repo not on the token curve.
- `src/pages/Home.module.css:189-194` (`.mobileMenuButton`):
  `transition: background-color var(--dur-med) ..., transform var(--dur-med) ...`
  with `:active { transform: translateY(1px) }` at lines 205-207 — press
  feedback should run 100-160 ms, not 220 ms.
- `src/pages/Login.module.css:166-173` — local tokens that stay but need
  documenting (see Steps 6-7): `--revert-dur: 280ms;` and
  `--shake-ease: cubic-bezier(0.22, 1, 0.36, 1);`

## Target

- The three literal copies of `cubic-bezier(0.16, 1, 0.3, 1)` become
  `var(--ease-out)`.
- `loginFormExit` uses `var(--ease-out)`.
- `overlayOut`'s exit curve becomes a named local custom property with a
  rationale comment (curve value unchanged — it is the correct shape for an
  exit).
- `.mobileMenuButton` press-relevant transitions run at `var(--dur-fast)`
  (150 ms).
- The Login local tokens gain one-line "deliberate exception" comments.

## Repo conventions to follow

- `main.tsx` loads `src/styles/tokens.css` globally, so `var(--ease-out)`
  resolves inside every CSS module without an `@import` (documented in
  `src/AppShell.tsx:46-48`).
- Exemplar of a documented local exception:
  `src/mentalScale/scaleUi/scaleUi.module.css:1-7` (sub-dialect header
  comment).

## Steps

1. `HomeIntroLogo.module.css:3` and `:46`:
   `cubic-bezier(0.16, 1, 0.3, 1)` → `var(--ease-out)` (both lines).
2. `HomeIntroLogo.module.css:31-34` — replace the `.isLeaving` rule with:

   ```css
   .isLeaving {
     /* Deliberate exit curve (fast leave, no settle) — the overlay hands
        the scene back to the app; ease-in shape is correct for exits. */
     --ease-exit: cubic-bezier(0.7, 0, 0.84, 0);
     animation: overlayOut 480ms var(--ease-exit) both;
     pointer-events: none;
   }
   ```

3. `LottieEegLogo.module.css:59`: `cubic-bezier(0.16, 1, 0.3, 1)` →
   `var(--ease-out)`.
4. `Login.module.css:57`: `ease-out` → `var(--ease-out)`.
5. `Home.module.css:189-194`: in the `.mobileMenuButton` transition list,
   change `box-shadow`, `opacity`, and `transform` entries from
   `var(--dur-med)` to `var(--dur-fast)` (keep `background-color` at
   `var(--dur-med)` if present — color can stay slower; if the list uses one
   duration for all, change only `transform` and `box-shadow`). The `:active`
   rule (lines 205-207) is unchanged.
6. `Login.module.css:167` — add above it:
   `/* Local exception: 280ms sits between --dur-fast and --dur-med by design — the form-revert snap is calmer than a control press. */`
7. `Login.module.css:171` — add above it:
   `/* Deliberate shake variant of --ease-out (softer attack for error jitter); do not swap to the token. */`

## Boundaries

- Do NOT change any duration, keyframe, or curve VALUE — only tokenization
  and comments, plus the one press-feedback duration change.
- Do NOT touch `Login.module.css:42` (`loginSceneExpand` curve — covered by
  plan 006's scope) or the `--shake-*` values.
- If lines drift from the excerpts, STOP and report.

## Verification

- **Mechanical**: `pnpm test` (calm style contract green), `pnpm build`;
  `grep -rn "0.16, 1, 0.3, 1" src --include=*.css` returns only the
  `tokens.css` definition.
- **Feel check**: skip the login intro (or let it play): the overlay exit
  feels identical to before. Press and hold the floating menu button: the
  press-down reads immediately under the finger (~150 ms), no longer
  lagging. Submit an empty login form: the shake is unchanged.
- **Done when**: no hand-typed duplicate of the dialect curve remains and
  the exceptions are documented.
