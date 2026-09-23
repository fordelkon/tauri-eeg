# 005 — Reset hover transforms under prefers-reduced-motion

- **Status**: DONE (executed 2026-09-23 on commit 4f567de)
- **Commit**: 4f567de
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 3 css files

## Problem

The reduced-motion blocks reset `:active` transforms and kill
transitions/animations, but the `:hover` TRANSFORMS survive — position-change
motion persists for reduced-motion users (as instant snaps, since the
transitions are killed). The repo's own convention of resetting hover
transforms exists at `MentalScaleDialog.module.css:257-259` and
`scaleUi.module.css:418-421`.

Occurrences (verified at commit 4f567de):

- `src/pages/Home.module.css` reduced-motion block at lines 1023-1077:
  resets `:active` (lines 1066-1076) but NOT any `:hover`. Affected hover
  transforms in the file:
  - `:166-169` `.menuButton:hover { transform: rotate(90deg); }`
  - `:199-203` `.mobileMenuButton:hover { transform: scale(1.05); }`
  - `:477-481` `.navItem:hover { transform: translateX(3px); }`
  - `:665-674` `.nextPageButton:hover { transform: translateX(4px); }` and
    `.nextPageButton:hover .nextPageIcon { transform: translate(2px, -2px); }`
  - `:744-747` `.railItem:hover { transform: translateX(3px); }`
- `src/pages/home/GameRegulation.module.css` — reduced-motion block at
  lines 193-203 vs `:92-94`:
  `.card:hover .imageFrame img { transform: scale(1.035); }`
- `src/pages/Login.module.css` — reduced-motion block at lines 471-496 vs
  `:353-359`:
  `.submitButton:hover { ... transform: translateY(-1px); }`

## Target

Each file's reduced-motion block gains `:hover { transform: none }` resets
for exactly the hover rules that move elements. Background/color/box-shadow
hover feedback is KEPT (reduced motion drops movement, not feedback).

## Repo conventions to follow

- Exemplar (repo's own correct pattern),
  `src/mentalScale/scaleUi/scaleUi.module.css:418-421`:

  ```css
  .anchorSelected:hover {
    transform: none;
  }
  ```

  (inside its `@media (prefers-reduced-motion: reduce)` block).

## Steps

1. `Home.module.css` — inside the reduced-motion block (lines 1023-1077),
   after the `:active` reset rule (lines 1066-1076), add:

   ```css
   .menuButton:hover,
   .mobileMenuButton:hover,
   .navItem:hover,
   .railItem:hover,
   .nextPageButton:hover,
   .nextPageButton:hover .nextPageIcon {
     transform: none;
   }
   ```

   Do NOT add `.mobileMenuButton.isHidden` — the `scale(0.88)` there is the
   hide state, not motion decoration; it must survive.
2. `GameRegulation.module.css` — inside the reduced-motion block
   (lines 193-203), add:

   ```css
   .card:hover .imageFrame img {
     transform: none;
   }
   ```

3. `Login.module.css` — inside the reduced-motion block (lines 471-496),
   add:

   ```css
   .submitButton:hover {
     transform: none;
   }
   ```

## Boundaries

- Do NOT remove the hover background/color/box-shadow changes.
- Do NOT touch `:active` resets (already correct).
- Execute AFTER plan 010 if both run: plan 010 rewrites some of the same
  `:hover`/`:active` rules in `Home.module.css` (the reset selectors here
  remain valid either way — `.navItem:hover`/`.railItem:hover` still exist
  even if their transform line was deleted; a `transform: none` reset on a
  rule without a transform is harmless, so no conflict).
- If the reduced-motion blocks drift from the line refs, locate them by
  `@media (prefers-reduced-motion: reduce)` and report what you find.

## Verification

- **Mechanical**: `pnpm test`, `pnpm build`.
- **Feel check**: toggle `prefers-reduced-motion: reduce` (DevTools Rendering
  panel), then hover: drawer nav items, rail items, the menu buttons, the
  nextPage CTA, a GameRegulation card, and the Login submit button — none
  changes position/scale; all still change background/shadow. Untoggle:
  transforms return.
- **Done when**: no hover rule moves an element while reduced motion is on.
