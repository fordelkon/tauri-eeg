# 003 — Put MUI Dialog and Popover motion on the calm dialect

- **Status**: DONE (executed 2026-09-23 on commit 4f567de)
- **Commit**: 4f567de
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens
- **Estimated scope**: 1 tsx file

## Problem

`src/AppShell.tsx:38-163` themes only `MuiButton` motion (lines 49-50, already
tokenized) and `MuiDialog` paper styling (lines 154-162). `MuiDialog` and
`MuiPopover` therefore run MUI's default transition (~225 ms,
`cubic-bezier(0.4, 0, 0.2, 1)`), while every hand-rolled dialog in the app
enters at `220ms var(--ease-out)` — e.g.
`src/mentalScale/MentalScaleDialog.module.css:30`,
`src/eeg/paradigm/ParadigmSession.module.css:658`,
`src/pages/home/VideoRegulationPlayer.module.css:23`. Two near-identical but
divergent dialog dialects.

Current theme tail (`src/AppShell.tsx:154-163`):

```tsx
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 14,
          // Calm depth: warm-tinted and softer than the old cool-ink drop.
          boxShadow: '0 24px 56px rgba(44, 34, 24, 0.16)',
        },
      },
    },
  },
});
```

## Target

`MuiDialog` and `MuiPopover` enter/exit with the dialect curve and duration:
enter 220 ms `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease-out` equivalent), exit
180 ms. Implemented via MUI's `Grow` transition with an explicit `easing`
prop (the `easing` prop exists on `Grow` in all MUI versions) wired through
theme `defaultProps`, so every `Dialog`/`Popover`/`Menu` inherits it without
per-call-site changes.

## Repo conventions to follow

- The theme file already resolves CSS custom properties inside MUI style
  objects: `src/AppShell.tsx:46-50` ("Dialect motion tokens (main.tsx loads
  tokens.css globally, so the var()s resolve here)"). Follow the same
  approach.
- `src/pages/home/EffectHistoryPanel.tsx` is a consumer of the stock MUI
  Dialog — after this plan it needs no local changes.

## Steps

1. In `src/AppShell.tsx`, add the MUI Grow import at the top with the other
   `@mui/material` imports:

   ```tsx
   import Grow from '@mui/material/Grow';
   ```

2. Above the `createTheme(...)` call (near the other module-level
   declarations), define the shared transition component:

   ```tsx
   /**
    * Dialog/Popover motion rides the calm dialect curve (--ease-out) instead
    * of MUI's default 225ms standard curve, so portal dialogs land the same
    * way the hand-rolled 220ms dialogs do. Exit is slightly quicker than
    * enter — the response snaps, the dismissal leaves sooner.
    */
   const CalmGrow = (props: React.ComponentProps<typeof Grow>) => (
     <Grow
       {...props}
       easing={{
         enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
         exit: 'cubic-bezier(0.7, 0, 0.84, 0)',
       }}
     />
   );
   ```

   (If the file does not already import `React` types, use
   `import type { ComponentProps } from 'react';` and type the prop as
   `ComponentProps<typeof Grow>`.)

3. Extend the theme components with `defaultProps` for both components — add
   these as siblings of the existing `MuiDialog` entry (before its
   `styleOverrides` key) and a new `MuiPopover` entry:

   ```tsx
    MuiDialog: {
      defaultProps: {
        TransitionComponent: CalmGrow,
        transitionDuration: { enter: 220, exit: 180 },
      },
      styleOverrides: { /* unchanged paper block */ },
    },
    MuiPopover: {
      defaultProps: {
        TransitionComponent: CalmGrow,
        transitionDuration: { enter: 220, exit: 180 },
      },
    },
   ```

## Boundaries

- Do NOT change `MuiButton` overrides, `MuiAlert`, or the paper styling.
- Do NOT touch any call-site (`useConfirmDialog.tsx`, `MentalScaleDialog`,
  `EffectReviewPopover`, `EffectHistoryPanel`) — the theme change is global.
- Do NOT hand-rolled-dialog CSS modules — their 220ms `var(--ease-out)` rules
  are already correct and stay.
- If the theme shape in `AppShell.tsx` drifts from the excerpt, STOP and
  report.

## Verification

- **Mechanical**: `pnpm test`, `pnpm build`.
- **Feel check**: open the effect-history panel dialog, the mental-scale
  dialog, and the effect review popover:
  - each scales/fades in with the same fast-settle feel as the hand-rolled
    paradigm dialog (compare side by side);
  - closing feels slightly quicker than opening.
- In DevTools Animations panel, confirm the enter duration is ~220 ms (not
  ~225 ms with a flat midpoint).
- **Done when**: stock MUI dialogs and hand-rolled dialogs are
  indistinguishable in rhythm.

## Execution note (2026-09-23)

Executed with one API adaptation: MUI v9 removed `TransitionComponent`/
`transitionDuration` from Dialog/Popover props (tsc rejected the plan's
exact shape). Ported to the v9 slots system per the official v9 migration
guide: `defaultProps: { slots: { transition: CalmGrow }, slotProps: { transition: { timeout: { enter: 220, exit: 180 } } } }`.
`CalmGrow` (Grow + dialect easing) is unchanged in spirit — enter
`cubic-bezier(0.16, 1, 0.3, 1)`, exit `cubic-bezier(0.7, 0, 0.84, 0)`.
`tsc` clean, 485/485 tests green.
