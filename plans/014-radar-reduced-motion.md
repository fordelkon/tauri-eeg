# 014 — Honor prefers-reduced-motion on the radar chart

- **Status**: DONE (executed 2026-09-23 on commit 4f567de)
- **Commit**: 4f567de
- **Severity**: LOW
- **Category**: Accessibility
- **Estimated scope**: 2 ts files

## Problem

The mental-scale radar chart's 520 ms entry animation ignores
`prefers-reduced-motion`, while the sibling result-chart builder honors it —
same product, inconsistent treatment.

`src/mentalScale/GlobalMentalScalePanel.tsx:160-162` — current:

```ts
    chart.setOption({
      animationDuration: 520,
      animationEasing: 'cubicOut',
```

The existing reduced-motion-aware helper:
`src/pages/home/effectResultChartOption.ts:22-33`:

```ts
/** Honors prefers-reduced-motion for the chart's entry animation. */
function chartAnimationDuration(): number {
  try {
    const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (query?.matches) {
      return 0;
    }
  } catch {
    // Non-DOM test environments fall through to the animated default.
  }
  return 520;
}
```

## Target

The radar chart's `animationDuration` comes from the shared helper (0 under
reduced motion, 520 otherwise). The helper is exported from
`effectResultChartOption.ts` so there is exactly one implementation.

## Repo conventions to follow

- The helper's try/catch + `globalThis.matchMedia?.` shape exists precisely
  so node-environment tests can import the module — keep it byte-identical,
  only add `export`.

## Steps

1. `src/pages/home/effectResultChartOption.ts:23`: change
   `function chartAnimationDuration(): number {` to
   `export function chartAnimationDuration(): number {`.
2. `src/mentalScale/GlobalMentalScalePanel.tsx`: add the import at the top:

   ```ts
   import { chartAnimationDuration } from '../pages/home/effectResultChartOption';
   ```

   (Verify the relative path from `src/mentalScale/` — it is
   `../pages/home/effectResultChartOption`.)
3. Change line 161 to:

   ```ts
      animationDuration: chartAnimationDuration(),
   ```

   Keep `animationEasing: 'cubicOut'` unchanged.

## Boundaries

- Do NOT change the helper's logic or move it to another module.
- Do NOT touch the radar's color/indicator/series options.
- If the panel's `setOption` block drifts from the excerpt, STOP and report.

## Verification

- **Mechanical**: `pnpm test` (effectResultChartOption's tests must still
  pass — the export is additive), `pnpm build`.
- **Feel check**: open the global mental-scale panel with animations on: the
  radar still draws in over ~520 ms. Toggle `prefers-reduced-motion: reduce`
  and reopen: the radar renders at full shape instantly.
- **Done when**: both chart families honor the setting.
