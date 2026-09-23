# Animation & Calm-Dialect Improvement Plans

Audit baseline: commit `4f567de` (branch `feat/closed-loop-regulation`).
Plans were written by the improve-animations audit (2026-09-23); every plan is
self-contained and can be executed by any agent with zero conversation context.

## Plan index

| # | Plan | Severity | Status |
|---|------|----------|--------|
| 001 | Wizard progress disclosure gets a retargetable expand/collapse | HIGH | DONE |
| 002 | Align the Home drawer choreography on one drawer recipe | MEDIUM | DONE |
| 003 | Put MUI Dialog/Popover motion on the calm dialect | MEDIUM | DONE |
| 004 | Tokenize and shorten the workspace entrance (460ms→300ms, dedupe ×4) | MEDIUM | DONE |
| 005 | Reset hover transforms under prefers-reduced-motion | MEDIUM | DONE |
| 006 | Fix the defeated reduced-motion guard on the login exit | MEDIUM | DONE |
| 007 | Add --ease-in-out token; migrate 12 oscillating pulses | LOW | DONE |
| 008 | Ease the wizard stage swap (step changes no longer hard-cut) | MEDIUM | DONE |
| 009 | Session-finished screen entrance + row cascade | MEDIUM | DONE |
| 010 | Calm the high-frequency hover decoration in the Home shell | LOW | DONE |
| 011 | Let the Home logo rest after one cycle | LOW | DONE |
| 012 | Feedback bar width→scaleX (last animated layout property) | LOW | DONE |
| 013 | Coalesce the matter-world ResizeObserver | LOW | DONE |
| 014 | Radar chart honors prefers-reduced-motion | LOW | DONE |
| 015 | Consolidate hand-typed curves onto tokens; press feedback at 150ms | LOW | DONE |

## Recommended execution order

1. **001** — highest leverage (core wizard flow, feel-breaking).
2. **002** — drawer close truncation (visible on every drawer use).
3. **004** — entrance token; touches `Home.module.css`, run before the other
   Home-plans to minimize drift.
4. **003** — independent (AppShell only).
5. **007** — adds `--ease-in-out` token (no dependents, but do token work
   before curve cleanup so greps settle).
6. **010** — Home hover decoration (rewrites `:hover`/`:active` rules).
7. **015** — same file's press durations + curve literals (run after 010 on
   the shared `.mobileMenuButton` block).
8. **005** — reduced-motion hover resets (depends on 010's final hover rule
   shapes; its selectors are safe either way, run last of the Home trio).
9. **006** — login guard fix (independent).
10. **008** — wizard stage swap.
11. **009** — finished-screen celebration.
12. **011** — Home logo rest state.
13. **012** — feedback bar scaleX.
14. **013** — matter ResizeObserver coalescing.
15. **014** — radar reduced-motion.

## Dependencies / conflict notes

- **Home.module.css** is touched by 002, 004, 005, 010, 015 — execute those
  strictly in the order above and re-verify line anchors if the repo moves
  between runs (every plan has a STOP-on-drift boundary).
- **005 depends on 010** only in that both rewrite hover behavior on the same
  selectors; 005's reset selectors remain correct regardless.
- **008 and 009** are additive entrances in different files; no interaction.
- **007's token** is consumed only by existing keyword swaps; nothing else
  depends on it.
- Plans 010 and 011 are product-taste decisions the user explicitly approved
  ("全部"); if that approval is ever revoked, retire those two plans.

## Global verification (after any batch of plans)

- `pnpm test` — including `calmStyleContract.test.ts` (sage/ink/red dialect
  must stay green).
- `pnpm build`.
- Manual pass in the running app (Chrome DevTools via `pnpm dev`, or
  `pnpm tauri dev`): walk login → home → each regulation module →
  effect-evaluation wizard → a paradigm session, with and without
  `prefers-reduced-motion`.
