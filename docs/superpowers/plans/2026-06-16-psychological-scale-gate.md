# Psychological Scale Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an anxiety/depression scale gate before entering Video Regulation, Game Regulation, and Music Regulation from Home navigation.

**Architecture:** Store scale definitions and completion logic in a focused pure TypeScript module. Home owns transient modal state and only navigates to regulation pages after all questions in the selected scale have answers.

**Tech Stack:** React 18, React Router, TypeScript, CSS Modules, Vitest.

---

### Task 1: Scale Definition Module

**Files:**
- Create: `src/mentalScale/mentalScaleGate.ts`
- Test: `src/mentalScale/mentalScaleGate.test.ts`

- [ ] Write tests proving regulation paths require scale gates, each gate has 2-3 anxiety/depression questions, and completion requires every question to be answered.
- [ ] Run focused Vitest and verify the tests fail because the module does not exist.
- [ ] Implement the scale definitions and helper functions.
- [ ] Run focused Vitest and verify the tests pass.

### Task 2: Home Modal Integration

**Files:**
- Modify: `src/pages/Home.tsx`
- Modify: `src/pages/Home.module.css`

- [ ] Import the scale helper module in Home.
- [ ] Add transient pending-scale and answer state.
- [ ] Change navigation handlers so Video/Game/Music open the scale modal before navigation.
- [ ] Add modal markup with 0-3 answer buttons and disabled continue button until complete.
- [ ] Add CSS for modal layout, mobile constraints, and button states.

### Task 3: Verification

**Files:**
- Validate all changed files.

- [ ] Run `pnpm test`.
- [ ] Run `pnpm run build`.
- [ ] Check `git diff --check` and `git status --short`.
