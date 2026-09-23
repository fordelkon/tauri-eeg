# 009 — Give the Session-finished screen its entrance and cascade

- **Status**: DONE (executed 2026-09-23 on commit 4f567de)
- **Commit**: 4f567de
- **Severity**: MEDIUM
- **Category**: Missed opportunity
- **Estimated scope**: 1 css file (1 tsx file if a class hook is needed)

## Problem

Ending a full paradigm recording session is the app's rarest, highest-emotion
moment, and the finished screen renders identically to any intermediate
panel — no entrance, no cascade, none of the delight budget it is allowed.
Contrast: the effect-evaluation result step already gets `heroEnter` + a
30 ms metric cascade.

`src/eeg/paradigm/ParadigmFinishedScreen.tsx:38-54` (current, abridged):

```tsx
  return (
    <div className={styles.panel} aria-label="范式 Session 训练前统计">
      <header className={styles.dialogHeader}>
        <p className={styles.dialogEyebrow}>Session 完成</p>
        <h2 className={styles.dialogTitle}>训练前统计</h2>
        ...
      </header>

      {summaryError ? <div className={styles.errorBanner}>{summaryError}</div> : null}

      {summary ? (
        <>
          <table className={styles.summaryTable}>
```

`.panel` (`src/eeg/paradigm/ParadigmSession.module.css:8-12`) is a plain grid:

```css
.panel {
  color: var(--ink-cool);
  display: grid;
  gap: 12px;
}
```

## Target

- `.panel` on this screen: one 320 ms rise-in.
- Summary table rows: a 30 ms-per-row staggered rise (first 8 rows), 240 ms
  each — the same cascade language as the result step's metric grid.
- Reduced motion: both drop to instant (add selectors to the file's existing
  reduced-motion block).

## Repo conventions to follow

- Entrance shape + fill: `EffectEvaluation.module.css:1209-1219` (`heroEnter`:
  opacity + `translate3d(0, 8px, 0)` → 0, `var(--ease-out) backwards`).
- Stagger exemplar: `EffectEvaluation.module.css:1296-1303` —
  `.metricGrid > :nth-child(2) { animation-delay: 30ms; }`
  `.metricGrid > :nth-child(3) { animation-delay: 60ms; }` (per-child delay
  rules, no loop).
- IMPORTANT: `.panel` is a SHARED class in `ParadigmSession.module.css`
  (other paradigm panels use it). Do not animate `.panel` directly — scope
  the entrance to a new modifier class used only by the finished screen.

## Steps

1. `ParadigmFinishedScreen.tsx` line 39: change the root div className to
   `${styles.panel} ${styles.panelFinished}`:

   ```tsx
    <div className={`${styles.panel} ${styles.panelFinished}`} aria-label="范式 Session 训练前统计">
   ```

2. `ParadigmSession.module.css` — add after the `.panel` rule:

   ```css
   /* Finished-session screen: the rarest, highest-emotion moment earns an
      entrance + a quiet per-row cascade (same language as the effect
      evaluation result step). Scoped to .panelFinished — plain .panel
      stays unanimated. */
   .panelFinished {
     animation: finishedEnter 320ms var(--ease-out) backwards;
   }

   .panelFinished .summaryTable tbody tr {
     animation: finishedRowIn 240ms var(--ease-out) backwards;
   }

   .panelFinished .summaryTable tbody tr:nth-child(2) {
     animation-delay: 30ms;
   }

   .panelFinished .summaryTable tbody tr:nth-child(3) {
     animation-delay: 60ms;
   }

   .panelFinished .summaryTable tbody tr:nth-child(4) {
     animation-delay: 90ms;
   }

   .panelFinished .summaryTable tbody tr:nth-child(5) {
     animation-delay: 120ms;
   }

   .panelFinished .summaryTable tbody tr:nth-child(6) {
     animation-delay: 150ms;
   }

   .panelFinished .summaryTable tbody tr:nth-child(7) {
     animation-delay: 180ms;
   }

   .panelFinished .summaryTable tbody tr:nth-child(8) {
     animation-delay: 210ms;
   }

   @keyframes finishedEnter {
     from {
       opacity: 0;
       transform: translate3d(0, 8px, 0);
     }

     to {
       opacity: 1;
       transform: translate3d(0, 0, 0);
     }
   }

   @keyframes finishedRowIn {
     from {
       opacity: 0;
       transform: translate3d(0, 6px, 0);
     }

     to {
       opacity: 1;
       transform: translate3d(0, 0, 0);
     }
   }
   ```

   If the summary table's rows are NOT in a `tbody` (check
   `ParadigmFinishedScreen.tsx`'s table markup), adjust the selector to the
   real row structure (e.g. `.summaryTable tr`).
3. In the file's `@media (prefers-reduced-motion: reduce)` block, add:

   ```css
   .panelFinished,
   .panelFinished .summaryTable tr {
     animation: none;
   }
   ```

## Boundaries

- Do NOT animate the error banner (it is an alert — alerts appear instantly).
- Do NOT touch other `.panel` consumers (setup/stat panels stay unanimated).
- Do NOT change any copy, table structure, or data logic.
- If `ParadigmSession.module.css` structure drifts, STOP and report.

## Verification

- **Mechanical**: `pnpm test`, `pnpm build`.
- **Feel check**: complete a dry-run paradigm session (试运行): the finished
  screen rises in once, then the statistic rows cascade in top-to-bottom;
  the header does not flash twice; returning and re-entering the screen
  replays it (acceptable — it is a terminal state screen).
- Toggle `prefers-reduced-motion`: everything appears instantly.
- **Done when**: the finished screen is visibly the "arrival" moment of the
  flow without any confetti-level loudness.
