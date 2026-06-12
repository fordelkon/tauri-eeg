# EEG Start State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make EEG Start Device report success only after valid EEG data arrives, while keeping retry and stop controls available during connection startup.

**Architecture:** Rust keeps the TCP server lifecycle separate from hardware data readiness. The frontend `starting` state represents "server started, waiting for valid EEG frames" and only transitions to `streaming` when `get_eeg_status().eegConnected` is true after Rust has parsed a real EEG frame.

**Tech Stack:** Rust/Tauri commands, React/TypeScript state reducer, Vitest, Cargo tests.

---

### Task 1: Frontend State Guards

**Files:**
- Modify: `src/eeg/eegSessionState.ts`
- Test: `src/eeg/eegSessionState.test.ts`

- [ ] Write tests showing `starting` can retry start and can stop the server.
- [ ] Run `npm test -- src/eeg/eegSessionState.test.ts` and verify the new stop guard test fails before implementation.
- [ ] Update `canStopDevice` so `starting` and `streaming` may stop; keep `stopping` disabled.
- [ ] Run `npm test -- src/eeg/eegSessionState.test.ts` and verify it passes.

### Task 2: Frontend Labels

**Files:**
- Modify: `src/eeg/EegControls.tsx`
- Modify: `src/pages/home/EegAcquisition.tsx`

- [ ] Pass `deviceStatus` to controls.
- [ ] Show `Retry Start` during `starting` and `Waiting for EEG` in the status pill.
- [ ] Keep Stop Device enabled during `starting`.
- [ ] Run `npm test -- src/eeg` and `npm run build`.

### Task 3: Rust Data-Confirmed Connection

**Files:**
- Modify: `src-tauri/src/eeg/server.rs`

- [ ] Add Rust tests for a helper that marks EEG connected only after valid EEG frame processing.
- [ ] Run `cargo test --lib eeg::server` and verify test failure before implementation when applicable.
- [ ] Move connection true marking out of TCP stream start and into first valid frame handling for each client kind.
- [ ] Keep connection false on socket disconnect.
- [ ] Run `cargo test --lib eeg::server`.

### Task 4: Final Verification

**Files:**
- No additional files.

- [ ] Run `npm test -- src/eeg`.
- [ ] Run `npm run build`.
- [ ] Run `cargo test --lib`.
- [ ] Review `git diff` to ensure only intended EEG files changed and `agentdb.rvf` remains untracked.
