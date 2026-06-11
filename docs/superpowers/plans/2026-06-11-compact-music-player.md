# Compact Music Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a smaller Music regulation player with a vertical layered prompt builder and history inside the player.

**Architecture:** Keep the feature inside `MusicRegulation.tsx` and `MusicRegulation.module.css` because the existing page already owns playback, generation, and history state. Add small helper functions for prompt composition and modal behavior without introducing new global state.

**Tech Stack:** React, TypeScript, CSS modules, MUI icon buttons.

---

### Task 1: Layered Prompt Builder State

**Files:**
- Modify: `src/pages/home/MusicRegulation.tsx`

- [ ] Replace the single prompt textarea state with instrument, style, details, and optional custom values.
- [ ] Add `buildPrompt` helper that joins the selected instrument, selected style, optional details, and `no vocals`.
- [ ] Update `handleGenerate` to send `generatedPrompt` instead of raw textarea text.
- [ ] Keep disabled state based on a non-empty generated prompt.

### Task 2: Compact Player and History Modal Markup

**Files:**
- Modify: `src/pages/home/MusicRegulation.tsx`

- [ ] Add `isHistoryOpen` state.
- [ ] Replace the existing `playerCard` markup with a compact horizontal player.
- [ ] Add a history icon button inside the compact player.
- [ ] Move the queue/history list into a modal rendered only when `isHistoryOpen` is true.
- [ ] Ensure selecting a history item changes active track and closes the modal.

### Task 3: Compact Styling

**Files:**
- Modify: `src/pages/home/MusicRegulation.module.css`

- [ ] Replace the two-column prompt/player layout with a top prompt column and lower row.
- [ ] Style the prompt builder as vertical layered controls with select boxes and optional custom inputs.
- [ ] Style the player as a small horizontal rounded card similar to the provided reference image.
- [ ] Remove or supersede the old queue panel styling.
- [ ] Add responsive behavior for mobile.

### Task 4: Verification

**Files:**
- No source edits expected.

- [ ] Run `npm test -- src/music/musicAssets.test.ts`.
- [ ] Run `npm run build`.
- [ ] If build cannot complete because of unrelated existing issues, record the exact failure.
