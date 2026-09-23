# 010 — Calm the high-frequency hover decoration in the Home shell

- **Status**: DONE (executed 2026-09-23 on commit 4f567de)
- **Commit**: 4f567de
- **Severity**: LOW (product taste decision — approved by the user)
- **Category**: Purpose & frequency
- **Estimated scope**: 1 css file

## Problem

Three hover effects on shell controls hit tens of times per session carry
motion that communicates nothing beyond the background-color shift that
accompanies them:

- The 540 ms per-letter roll on drawer nav labels — double the 300 ms UI
  budget, pure decoration on a high-frequency hover.
  `src/pages/Home.module.css:533-548`:

  ```css
  .rollingText span {
    backface-visibility: hidden;
    display: block;
    flex-shrink: 0;
    line-height: inherit;
    /* Duration rides the hover letter-roll choreography (no token above
       --dur-med); the easing stays on the dialect curve. */
    transition: transform 540ms var(--ease-out);
    transition-delay: calc(var(--letter-index, 0) * 13ms);
    white-space: pre;
  }

  .navItem:hover .rollingText span,
  .navItem:focus-visible .rollingText span {
    transform: translateY(calc(var(--line-height-abs) * -1));
  }
  ```

- Decorative hover shifts on list items passed over constantly.
  `Home.module.css:477-481`:

  ```css
  .navItem:hover {
    background: rgba(44, 34, 24, 0.06);
    color: #2c2218;
    transform: translateX(3px);
  }
  ```

  and `Home.module.css:744-748` (`.railItem:hover`, identical recipe), with
  composing `:active` rules at `:483-485` / `:750-752`
  (`transform: translate(3px, 1px);`).

- The floating menu button's press drops the hovered scale instead of
  composing with it. `Home.module.css:199-207`:

  ```css
  .mobileMenuButton:hover {
    background: #f5f0eb;
    box-shadow: var(--shadow-lift);
    transform: scale(1.05);
  }

  .mobileMenuButton:active {
    transform: translateY(1px);
  }
  ```

  (The `.menuButton` drawer toggle at lines 166-173 is left alone — its
  rotate composes correctly and it is occasional.)

## Target

- Letter roll: 280 ms total, 8 ms per-letter delay — still a delight moment,
  inside the UI budget.
- `.navItem` / `.railItem`: hover/active keep ONLY the background + color
  feedback; the translateX shift is removed.
- `.mobileMenuButton`: press compresses the hovered control instead of
  replacing its state (`:active` composes scale + translateY).

## Repo conventions to follow

- The letter-roll span markup stays (`Home.tsx:66-78` `renderRollingText`).
  Only CSS timing changes.
- Press-feedback exemplar that composes correctly:
  `Home.module.css:171-173` (`.menuButton:active { transform: rotate(90deg) translateY(1px); }`).

## Steps

1. `Home.module.css:540-541`:

   ```css
   transition: transform 280ms var(--ease-out);
   transition-delay: calc(var(--letter-index, 0) * 8ms);
   ```

   Update the comment above it to:
   `/* Letter-roll stays inside the UI budget (280ms); the easing stays on the dialect curve. */`

2. `.navItem:hover` (lines 477-481): delete the `transform: translateX(3px);`
   line (keep background and color).

3. `.navItem:active` (lines 483-485): replace
   `transform: translate(3px, 1px);` with `transform: translateY(1px);`.

4. `.railItem:hover` (lines 744-748): delete the `transform: translateX(3px);`
   line.

5. `.railItem:active` (lines 750-752): replace
   `transform: translate(3px, 1px);` with `transform: translateY(1px);`.

6. `.mobileMenuButton:active` (lines 205-207): replace
   `transform: translateY(1px);` with `transform: scale(0.97) translateY(1px);`
   so pressing while hovered compresses the scaled control.

## Boundaries

- Do NOT touch `.menuButton` (drawer toggle) hover/active.
- Do NOT touch `.nextPageButton` hover — its `translateX(4px)` reads as
  directional meaning (next module) and it is a once-per-step CTA.
- Do NOT remove the per-letter span markup in `Home.tsx`.
- The reduced-motion block at lines 1043-1045
  (`.rollingText span { transition: none; }`) and the `:active` reset list
  (lines 1066-1076) already cover these selectors — no change needed there
  in THIS plan (hover-transform resets are plan 005's job).
- If lines drift, STOP and report.

## Verification

- **Mechanical**: `pnpm test`, `pnpm build`.
- **Feel check**: hover drawer nav items: the letter roll completes quickly
  and reads as a flick, not a performance; the row itself no longer shunts
  sideways under the cursor. Hover + press the floating menu button: it
  presses down from its enlarged state, no pop.
- **Done when**: no hover in the Home shell moves an element more than the
  nextPageButton's directional shift.
