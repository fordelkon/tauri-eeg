# EEG Display Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the EEG display easier to inspect when packets are imperfect by defaulting to four visible channels and placing channel selection above the waveform.

**Architecture:** Keep the existing 32-channel stream and max-16 channel selection. Change only the display defaults and page layout: channel controls become a top strip, waveform fills the remaining panel height, and fullscreen-sized layouts avoid internal page scrolling.

**Tech Stack:** React, TypeScript, CSS Modules, Vitest, uPlot.

---

### Task 1: Default visible channel count

**Files:**
- Modify: `src/eeg/channels.ts`
- Modify: `src/eeg/eegSessionStore.test.ts`

- [x] Add/adjust tests so `DEFAULT_VISIBLE_EEG_CHANNEL_IDS` equals `ch01` through `ch04`.
- [x] Change the default visible channel count to four while preserving `MAX_VISIBLE_EEG_CHANNELS = 16`.
- [x] Run `npm test -- src/eeg/eegSessionStore.test.ts`.

### Task 2: Top channel selector and bottom waveform

**Files:**
- Modify: `src/pages/home/EegAcquisition.tsx`
- Modify: `src/pages/home/EegAcquisition.module.css`
- Modify: `src/eeg/EegChannelList.tsx`

- [x] Update markup so the channel selector renders above the waveform panel.
- [x] Update CSS so `.monitorGrid` uses vertical rows, channel toggles are compact, and `.waveformPanel` fills the remaining height without requiring scrolling in fullscreen-sized layouts.
- [x] Run `npm test -- src/eeg`.
- [x] Run `npm run build`.
