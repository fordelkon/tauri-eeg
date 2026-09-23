# 008 — Ease the wizard stage swap

- **Status**: DONE (executed 2026-09-23 on commit 4f567de)
- **Commit**: 4f567de
- **Severity**: MEDIUM
- **Category**: Missed opportunity
- **Estimated scope**: 1 tsx file, 1 css file

## Problem

The six-step wizard (the product's core flow) hard-cuts all stage content on
every step change: the kicker, title, hint, and stage body swap instantly
inside the never-remounted `<section className={styles.stage}>`.

`src/pages/home/EffectEvaluation.tsx:461-479` (current, abridged):

```tsx
        <section
          ref={stageRef}
          tabIndex={-1}
          className={`${styles.stage}${state.step === 5 ? ` ${styles.stageFlat}` : ''}`}
          aria-label="当前任务"
        >
          <p className={styles.stageKicker}>
            步骤 {state.step + 1} / {EFFECT_FLOW_STEP_COUNT} · {currentNode.title}
          </p>
          {!isWindowRunning ? (
            <>
              <h2 className={styles.stageTitle}>{currentNode.stageTitle}</h2>
              <p className={styles.stageHint}>{currentNode.stageHint}</p>
            </>
          ) : null}

          {renderStageBody(state.step)}
```

`.stageBody` (`EffectEvaluation.module.css:2258-2261`) carries no entrance.
The kicker/leaderboard text also swaps with no transition.

## Target

A keyed wrapper around the whole mutable stage interior plays a 200 ms
fade + 8 px rise on every step change. `backwards` fill, dialect easing.
The section itself never remounts (focus/scroll behavior on `stageRef` is
preserved).

## Repo conventions to follow

- One-shot mount entrances use `animation: ... var(--ease-out) backwards;`
  with an explanatory comment — see
  `EffectEvaluation.module.css:1200` (`heroEnter 420ms var(--ease-out) backwards`)
  and the fill-mode rationale comment at lines 40-45.
- Keyframe shape exemplar — `heroEnter`, `EffectEvaluation.module.css:1209-1219`:

  ```css
  @keyframes heroEnter {
    from {
      opacity: 0;
      transform: translate3d(0, 8px, 0);
    }

    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }
  ```

- Reduced motion: entrance-only animations can simply get
  `animation: none` in the file's existing reduced-motion block (find it
  with a grep — the file has one).

## Steps

1. `EffectEvaluation.tsx` — wrap the stage interior (kicker through stage
   body, NOT the footer row) in a keyed div:

   ```tsx
          <div key={state.step} className={styles.stageSwap}>
            <p className={styles.stageKicker}>
              步骤 {state.step + 1} / {EFFECT_FLOW_STEP_COUNT} · {currentNode.title}
            </p>
            {!isWindowRunning ? (
              <>
                <h2 className={styles.stageTitle}>{currentNode.stageTitle}</h2>
                <p className={styles.stageHint}>{currentNode.stageHint}</p>
              </>
            ) : null}

            {renderStageBody(state.step)}
          </div>
   ```

   The conditional-countdown swap (`isWindowRunning`) stays INSIDE the
   wrapper — countdown appearing/disappearing mid-step should NOT re-trigger
   the entrance; only `key={state.step}` remounts it.
2. `EffectEvaluation.module.css` — add near `.stageBody` (after line 2261):

   ```css
   /* Step-change entrance: keyed by the flow step in EffectEvaluation.tsx,
      so each advance replays one short rise. backwards releases the
      transform at animation end (same fixed-position rationale as
      .workspace above). */
   .stageSwap {
     animation: stageSwapIn 200ms var(--ease-out) backwards;
     display: grid;
     gap: 14px;
   }

   @keyframes stageSwapIn {
     from {
       opacity: 0;
       transform: translate3d(0, 8px, 0);
     }

     to {
       opacity: 1;
       transform: translate3d(0, 0, 0);
     }
   }
   ```

   Remove the now-redundant `display: grid; gap: 14px;` from `.stageBody`
   ONLY if `.stageBody` instances are always inside the wrapper — verify
   with a grep of `styles.stageBody` before removing; if used anywhere else,
   leave `.stageBody` untouched and keep both grids (nested grid+grid with
   the same gap is harmless here).

3. In the file's `@media (prefers-reduced-motion: reduce)` block, add
   `.stageSwap { animation: none; }`.

## Boundaries

- Do NOT touch `stageRef`/`tabIndex`/focus logic or the footer row.
- Do NOT change `renderStageBody` internals or step content.
- Do NOT animate the countdown digits (`isWindowRunning` branch stays
  unanimated).
- If lines drift from the excerpts, STOP and report.

## Verification

- **Mechanical**: `pnpm test` (EffectEvaluation flow tests), `pnpm build`.
- **Feel check**: walk the wizard ①→⑥: each advance plays one short
  200 ms rise of the stage content; the countdown start/end does NOT replay
  the entrance; focusing the stage after a step still scrolls correctly.
- Toggle `prefers-reduced-motion`: step changes are instant cuts.
- **Done when**: no step advance hard-cuts.
