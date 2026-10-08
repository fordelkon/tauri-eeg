# 018 — Align Experiment Settings surfaces and text onto the calm-dialect tokens

- **Status**: DONE
- **Commit**: a09c7bf
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens
- **Estimated scope**: 1 file (~30 lines changed)

## Problem

`ExperimentSettings.module.css` hardcodes ad-hoc ink alphas and off-dialect
surfaces instead of riding the shared token ladder, so the page reads slightly
"off" next to EffectEvaluation and the regulation pages:

```css
/* src/pages/home/ExperimentSettings.module.css — current */
/* :7  */ .lede { color: rgba(44, 34, 24, .68); font-size: var(--text-base); margin: 0; max-width: 62ch; }
/* :8  */ .section { padding: 22px 24px 24px; border: 1px solid var(--line-soft); border-radius: var(--radius-card); margin: 0; background: rgba(255, 250, 243, .72); box-shadow: var(--shadow-card); }
/* :11 */ .sectionLead { color: rgba(44, 34, 24, .58); font-size: var(--text-sm); margin: 5px 0 0; }
/* :14 */ .page input, .page select { font: inherit; color: inherit; background: var(--surface-raised); border: 1px solid var(--line-strong); border-radius: var(--radius-control); padding: 11px 12px; box-sizing: border-box; width: 100%; }
/* :25 */ .stepRail { display: flex; gap: 10px; align-items: center; color: rgba(44,34,24,.55); font-size: var(--text-sm); font-weight: 650; }
/* :26 */ .stepRail span { border-radius: 999px; padding: 7px 12px; border: 1px solid var(--line-soft); background: rgba(255,250,243,.72); }
/* :32 */ .muted { font-size: var(--text-sm); opacity: .65; }
```

Issues, vetted against `src/styles/tokens.css`:

- The hairline ladder (`--line-soft` / `--line` / `--line-strong`,
  tokens.css:71-73) exists precisely so pages stop typing `rgba(44,34,24,x)`
  by hand — but this page types it anyway (`.lede`, `.sectionLead`,
  `.stepRail`), and the card background `rgba(255, 250, 243, .72)` is a
  one-off tint no other page uses (EffectEvaluation panels use
  `rgba(255, 255, 255, .84)`, EffectEvaluation.module.css:590).
- Inputs/selects have **no hover feedback and no transition**
  (module.css:14); EffectEvaluation inputs darken their border on hover and
  transition it (EffectEvaluation.module.css:774-781).
- `.muted` uses `opacity: .65` — opacity on the whole element vs. a text-tier
  color; the app convention is alpha-on-color (e.g.
  EffectEvaluation.module.css:1270 `.musicHistoryItemMeta` →
  `color: rgba(var(--ee-ink-rgb), 0.6)`).

## Target

```css
/* target */
.section { padding: 22px 24px 24px; border: 1px solid var(--line); border-radius: var(--radius-card); margin: 0; background: rgba(255, 255, 255, .84); box-shadow: var(--shadow-card); }
.lede { color: rgba(44, 34, 24, .66); font-size: var(--text-base); margin: 0; max-width: 62ch; }
.sectionLead { color: rgba(44, 34, 24, .58); font-size: var(--text-sm); margin: 5px 0 0; }
.page input, .page select { font: inherit; color: inherit; background: var(--surface-raised); border: 1px solid var(--line-strong); border-radius: var(--radius-control); padding: 11px 12px; box-sizing: border-box; width: 100%; transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out); }
.page input:hover:enabled, .page select:hover:enabled { border-color: rgba(44, 34, 24, .34); }
.stepRail { display: flex; gap: 10px; align-items: center; color: rgba(44,34,24,.55); font-size: var(--text-sm); font-weight: 650; }
.stepRail span { border-radius: 999px; padding: 7px 12px; border: 1px solid var(--line-soft); background: rgba(255,255,255,.72); }
.muted { font-size: var(--text-sm); color: rgba(44, 34, 24, .55); }
```

Notes:

- Keep the existing focus rule (`.page button:focus-visible, … { outline:
  none; box-shadow: var(--focus-ring); }` at module.css:19) — `--focus-ring`
  is the app-wide recipe and already correct.
- Text tiers: body copy `.66`, meta/lead `.58`, muted `.55` — matching the
  EffectEvaluation secondary steps (`.description` .66 at
  EffectEvaluation.module.css:277, `.stageHint` .66, muted meta .55–.6).

## Repo conventions to follow

- Token definitions: `src/styles/tokens.css:71-73` (hairlines),
  `:100-105` (motion), `:24-26` (surfaces).
- Exemplar file: `src/pages/home/EffectEvaluation.module.css` — copy its
  hover/transition pattern for inputs from `.textInput` at :765-788 (adapted
  to warm ink since this is a shell page, not a cool-ink monitor page).

## Steps

1. **`src/pages/home/ExperimentSettings.module.css`** — apply each Target
   rule above, replacing the current line content. The only additions are the
   input `transition` and `:hover:enabled` rule; everything else is a value
   swap.
2. **Same file** — extend the reduced-motion block (`:39`) with:
   ```css
   .page input, .page select { transition: none; }
   ```
3. **No TSX changes** — this plan is CSS-only.

## Boundaries

- Do NOT change the `.page h1/h2` display sizes or `.eyebrow` — the round-9
  type-scale consolidation (see tokens.css:43-54) already governs them.
- Do NOT touch `.sectionIndex`, `.nextStepButton`, `.check`, `.history`,
  `.error`, `.notice` (error/notice are plan 017's scope).
- Do NOT change `ExperimentRunHistory.tsx` or `ParadigmSessionPanel`.
- If the stylesheet no longer matches the "current" excerpts (drift since
  a09c7bf), STOP and report.

## Verification

- **Mechanical**: `pnpm vitest run src/pages/home` passes.
- **Feel check**: run the UI:
  - Section cards read as white-on-tint like EffectEvaluation panels, with
    one hairline and the same soft shadow — no yellowish one-off tint.
  - Hovering the COM-port select darkens its border smoothly (~150ms);
    tabbing in still paints the app-wide focus ring.
  - Muted helper lines (串口写入成功不代表…) read as quiet gray-ink, not
    semi-transparent black.
  - Toggle `prefers-reduced-motion`: input hover/focus snaps instantly.
- **Done when**: no `rgba(44, 34, 24, …)` value outside the documented text
  tiers (.82/.66/.58/.55) and no `rgba(255, 250, 243, …)` remains in the file.
