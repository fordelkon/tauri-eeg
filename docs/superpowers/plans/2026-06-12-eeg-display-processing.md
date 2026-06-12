# EEG Display Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the realtime EEG display readable by applying display-only DC removal, clipping, and min/max downsampling while preserving raw recording data.

**Architecture:** Add a pure TypeScript display processing module used only by the waveform panel. `EegRingBuffer` and Rust recording continue to store raw uV values; `EegWaveformPanel` converts the snapshot into processed plotting data immediately before applying channel lane offsets.

**Tech Stack:** React, TypeScript, Vitest, uPlot.

---

### Task 1: Display processing helper

**Files:**
- Create: `src/eeg/eegDisplayProcessing.ts`
- Create: `src/eeg/eegDisplayProcessing.test.ts`

- [ ] Write failing tests for removing per-channel DC offset, clipping values to a display limit, and preserving raw input arrays.
- [ ] Implement `processEegDisplayData(input, options)` that returns processed `x` and `seriesByChannel`.
- [ ] Run `npm test -- src/eeg/eegDisplayProcessing.test.ts`.

### Task 2: Min/max downsampling

**Files:**
- Modify: `src/eeg/eegDisplayProcessing.ts`
- Modify: `src/eeg/eegDisplayProcessing.test.ts`

- [ ] Write a failing test showing that each bucket emits min and max points so spikes are preserved.
- [ ] Implement `targetPointCount` support with min/max bucket downsampling.
- [ ] Run `npm test -- src/eeg/eegDisplayProcessing.test.ts`.

### Task 3: Wire processing into waveform panel

**Files:**
- Modify: `src/eeg/EegWaveformPanel.tsx`
- Modify: `src/eeg/eegSessionStore.ts`
- Modify: `src/eeg/eegSessionStore.test.ts`

- [ ] Keep the original 10 second default window and `5/10/30` options.
- [ ] Use `processEegDisplayData` before lane offsets in `EegWaveformPanel`.
- [ ] Compute clipping from the current amplitude scale so display stays bounded.
- [ ] Run `npm test -- src/eeg`.
- [ ] Run `npm run build`.
