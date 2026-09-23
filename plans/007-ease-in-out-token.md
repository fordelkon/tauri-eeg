# 007 — Add the --ease-in-out token and migrate the oscillating pulses

- **Status**: DONE (executed 2026-09-23 on commit 4f567de)
- **Commit**: 4f567de
- **Severity**: LOW (consolidation; no behavior change)
- **Category**: Cohesion & tokens
- **Estimated scope**: 5 css files, 1 tokens file

## Problem

`src/styles/tokens.css:66-69` defines only `--dur-fast`, `--dur-med`,
`--ease-out`. Every oscillating/breathing effect in the app therefore falls
back to the weak built-in `ease-in-out` keyword (12 occurrences). The dialect
has no token for on-screen morphs, so the next author will type the keyword
again.

Note: an earlier audit flagged `progressDotPulse`/`stationPulse`
(`EffectEvaluation.module.css:1890, 2047`) for a "hard restart" — on re-check
they are ping-style keyframes whose both ends are transparent, so their loop
boundary is seamless. They are NOT changed by this plan.

## Target

- New token in `src/styles/tokens.css` (Motion section):

  ```css
  /* Oscillating/breathing motion (pulses, equalizers): the strong in-out
     curve; the built-in keyword is too weak for deliberate morphs. */
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  ```

- Migrate every `ease-in-out` keyword in animation shorthands to
  `var(--ease-in-out)`. Exact occurrences (verified at commit 4f567de):
  - `src/pages/home/EegAcquisition.module.css:108`
    (`animation: statusPillPulse 1.1s ease-in-out infinite;`)
  - `src/pages/home/EffectEvaluation.module.css:657` and `:1166`
    (`animation: loadingPulse 1.1s ease-in-out infinite;`)
  - `src/agent/ExperimentAgentPanel.module.css:224`
    (`animation: agentThinkingPulse 0.9s ease-in-out infinite;`)
  - `src/homeIntro/LottieEegLogo.module.css:20, 36, 45, 52, 75, 80, 85, 90`
    (eight `... ease-in-out ... infinite` animation shorthands)

## Repo conventions to follow

- Token naming/style: see the existing Motion block in
  `src/styles/tokens.css` (`--ease-out: cubic-bezier(0.16, 1, 0.3, 1);` with
  a short rationale comment).

## Steps

1. `src/styles/tokens.css`: add `--ease-in-out` per the Target block.
2. In each of the five files above, replace the bare `ease-in-out` keyword
   inside `animation:` shorthands with `var(--ease-in-out)`. In
   `LottieEegLogo.module.css` this is a single `replace_all` of
   `ease-in-out` → `var(--ease-in-out)` within animation lines (the file has
   no other use of the token). Do the same per occurrence in the other files.
3. Do NOT touch `src/pages/Login.module.css:42`
   (`cubic-bezier(0.76, 0, 0.24, 1)` — first-run art, deliberate, covered by
   plan 015's documentation step) or any `cubic-bezier(...)` literals.

## Boundaries

- Do NOT change durations, keyframes, or `infinite` flags.
- Do NOT touch the ping pulses (`progressDotPulse`, `stationPulse`) — they
  use `var(--ease-out)` correctly.
- If `grep -n "ease-in-out" src --include=*.css` returns occurrences beyond
  the 12 listed (excluding Login's `cubic-bezier`), report them instead of
  blindly replacing.

## Verification

- **Mechanical**: `pnpm test`, `pnpm build`;
  `grep -rn "ease-in-out" src --include=*.css` returns only
  `tokens.css` (the definition) and any comments.
- **Feel check**: watch the agent thinking dots, the recording pill pulse,
  and the loading pulses for a few seconds — the breathing should read as
  slightly more deliberate (stronger decel/accel); nothing should look
  broken. The logo's hex/wave/halo loops keep their rhythm.
- Toggle `prefers-reduced-motion`: all of these loops stop (existing guards
  unchanged).
- **Done when**: the token exists and no bare `ease-in-out` keyword remains.
