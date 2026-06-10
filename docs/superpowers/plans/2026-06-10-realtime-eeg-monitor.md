# Realtime EEG Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first EEG Acquisition realtime monitor where Rust/Tauri generates simulated EEG blocks and the React frontend only subscribes, buffers, and renders them.

**Architecture:** Add a Rust `eeg` module that owns simulated acquisition lifecycle, generates deterministic blocks, and emits `eeg://sample-block` events. Add a frontend `src/eeg` feature area for Tauri command/event wrappers, ring buffering, display state, uPlot rendering, and BioSemi ActiView-inspired controls.

**Tech Stack:** Rust, Tauri 2 events/commands, React 18, TypeScript, Vite, MUI, CSS modules, `uplot`, Vitest.

---

## File Structure

- Modify `package.json`: add `test` script and dependencies for `vitest`, `uplot`.
- Modify `vite.config.ts`: add Vitest test config.
- Create `src-tauri/src/eeg.rs`: Rust EEG channel definitions, simulated generator, stream state, Tauri event loop, and tests.
- Modify `src-tauri/src/lib.rs`: manage EEG stream state and expose `start_eeg_stream`, `stop_eeg_stream`.
- Create `src/eeg/types.ts`: frontend channel, payload, settings, status types.
- Create `src/eeg/channels.ts`: default 16-channel montage labels matching Rust channel IDs.
- Create `src/eeg/eegApi.ts`: Tauri command and event wrapper.
- Create `src/eeg/eegRingBuffer.ts`: fixed-window display buffer for backend payloads.
- Create `src/eeg/eegRingBuffer.test.ts`: ring buffer tests.
- Create `src/eeg/useRealtimeEeg.ts`: frontend command/event lifecycle and display-state hook.
- Create `src/eeg/EegControls.tsx`: start, stop, pause display, reset, time window, amplitude scale.
- Create `src/eeg/EegChannelList.tsx`: channel visibility toggles.
- Create `src/eeg/EegWaveformPanel.tsx`: uPlot integration.
- Create `src/pages/home/EegAcquisition.module.css`: acquisition route layout.
- Modify `src/pages/home/EegAcquisition.tsx`: compose the workspace.

---

### Task 1: Add Frontend Test and Chart Dependencies

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: Add dependencies**

Run:

```powershell
npm install uplot
npm install -D vitest
```

Expected:

- `package.json` gains `uplot` under `dependencies`.
- `package.json` gains `vitest` under `devDependencies`.
- `package-lock.json` updates.

- [ ] **Step 2: Add a test script**

In `package.json`, update `scripts` to include:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run"
  }
}
```

- [ ] **Step 3: Add Vitest config**

In `vite.config.ts`, add this line at the top:

```ts
/// <reference types="vitest" />
```

Inside the Vite config object, add:

```ts
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
```

- [ ] **Step 4: Commit dependency setup**

```powershell
git add package.json package-lock.json vite.config.ts
git commit -m "test(eeg): add frontend test harness"
```

---

### Task 2: Add Rust EEG Generator and Tests

**Files:**
- Create: `src-tauri/src/eeg.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Register the module only**

In `src-tauri/src/lib.rs`, add:

```rust
mod eeg;
```

- [ ] **Step 2: Write failing Rust tests**

Create `src-tauri/src/eeg.rs` with tests first:

```rust
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EegSampleBlockPayload {
    pub sequence: u64,
    pub sample_rate_hz: u32,
    pub started_at_ms: i64,
    pub channel_ids: Vec<String>,
    pub samples: Vec<Vec<f32>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_expected_sample_block_shape() {
        let block = create_simulated_eeg_block(7, 1_000, 500, 50).expect("create block");

        assert_eq!(block.sequence, 7);
        assert_eq!(block.sample_rate_hz, 500);
        assert_eq!(block.started_at_ms, 1_000);
        assert_eq!(block.channel_ids.len(), 16);
        assert_eq!(block.samples.len(), 16);
        assert_eq!(block.samples[0].len(), 25);
    }

    #[test]
    fn creates_deterministic_samples_for_same_inputs() {
        let first = create_simulated_eeg_block(3, 2_000, 500, 50).expect("first block");
        let second = create_simulated_eeg_block(3, 2_000, 500, 50).expect("second block");

        assert_eq!(first.samples[0], second.samples[0]);
        assert_eq!(first.samples[5], second.samples[5]);
    }

    #[test]
    fn rejects_invalid_stream_settings() {
        assert_eq!(
            create_simulated_eeg_block(0, 0, 0, 50).unwrap_err(),
            "EEG sample rate must be positive."
        );
        assert_eq!(
            create_simulated_eeg_block(0, 0, 500, 0).unwrap_err(),
            "EEG block interval must be positive."
        );
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```powershell
cargo test eeg
```

Working directory:

```text
src-tauri
```

Expected: FAIL because `create_simulated_eeg_block` is not defined.

- [ ] **Step 4: Implement Rust EEG generator**

Replace `src-tauri/src/eeg.rs` with:

```rust
use serde::Serialize;

pub const EEG_SAMPLE_BLOCK_EVENT: &str = "eeg://sample-block";
pub const DEFAULT_SAMPLE_RATE_HZ: u32 = 500;
pub const DEFAULT_BLOCK_INTERVAL_MS: u64 = 50;

const DEFAULT_CHANNEL_IDS: [&str; 16] = [
    "fp1", "fp2", "f3", "f4", "c3", "c4", "p3", "p4",
    "o1", "o2", "f7", "f8", "t7", "t8", "p7", "p8",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EegStreamInfo {
    pub sample_rate_hz: u32,
    pub block_interval_ms: u64,
    pub channel_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EegSampleBlockPayload {
    pub sequence: u64,
    pub sample_rate_hz: u32,
    pub started_at_ms: i64,
    pub channel_ids: Vec<String>,
    pub samples: Vec<Vec<f32>>,
}

pub fn default_stream_info() -> EegStreamInfo {
    EegStreamInfo {
        sample_rate_hz: DEFAULT_SAMPLE_RATE_HZ,
        block_interval_ms: DEFAULT_BLOCK_INTERVAL_MS,
        channel_ids: DEFAULT_CHANNEL_IDS.iter().map(|id| id.to_string()).collect(),
    }
}

pub fn create_simulated_eeg_block(
    sequence: u64,
    started_at_ms: i64,
    sample_rate_hz: u32,
    block_interval_ms: u64,
) -> Result<EegSampleBlockPayload, String> {
    if sample_rate_hz == 0 {
        return Err("EEG sample rate must be positive.".to_string());
    }
    if block_interval_ms == 0 {
        return Err("EEG block interval must be positive.".to_string());
    }

    let sample_count = ((sample_rate_hz as u64 * block_interval_ms) / 1_000).max(1) as usize;
    let mut samples = Vec::with_capacity(DEFAULT_CHANNEL_IDS.len());

    for channel_index in 0..DEFAULT_CHANNEL_IDS.len() {
        let mut channel_samples = Vec::with_capacity(sample_count);
        let alpha_hz = 8.0 + (channel_index % 5) as f32;
        let theta_hz = 4.0 + (channel_index % 3) as f32 * 0.5;
        let noise_phase = channel_index as f32 * 0.91 + sequence as f32 * 0.13;

        for sample_index in 0..sample_count {
            let absolute_index = sequence as f32 * sample_count as f32 + sample_index as f32;
            let t = absolute_index / sample_rate_hz as f32;
            let alpha = (2.0 * std::f32::consts::PI * alpha_hz * t).sin() * 28.0;
            let theta = (2.0 * std::f32::consts::PI * theta_hz * t + channel_index as f32).sin() * 12.0;
            let slow_drift = (2.0 * std::f32::consts::PI * 0.2 * t + channel_index as f32 * 0.2).sin() * 18.0;
            let line_noise = (2.0 * std::f32::consts::PI * 50.0 * t + noise_phase).sin() * 2.5;

            channel_samples.push(alpha + theta + slow_drift + line_noise);
        }

        samples.push(channel_samples);
    }

    Ok(EegSampleBlockPayload {
        sequence,
        sample_rate_hz,
        started_at_ms,
        channel_ids: DEFAULT_CHANNEL_IDS.iter().map(|id| id.to_string()).collect(),
        samples,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_expected_sample_block_shape() {
        let block = create_simulated_eeg_block(7, 1_000, 500, 50).expect("create block");

        assert_eq!(block.sequence, 7);
        assert_eq!(block.sample_rate_hz, 500);
        assert_eq!(block.started_at_ms, 1_000);
        assert_eq!(block.channel_ids.len(), 16);
        assert_eq!(block.samples.len(), 16);
        assert_eq!(block.samples[0].len(), 25);
    }

    #[test]
    fn creates_deterministic_samples_for_same_inputs() {
        let first = create_simulated_eeg_block(3, 2_000, 500, 50).expect("first block");
        let second = create_simulated_eeg_block(3, 2_000, 500, 50).expect("second block");

        assert_eq!(first.samples[0], second.samples[0]);
        assert_eq!(first.samples[5], second.samples[5]);
    }

    #[test]
    fn rejects_invalid_stream_settings() {
        assert_eq!(
            create_simulated_eeg_block(0, 0, 0, 50).unwrap_err(),
            "EEG sample rate must be positive."
        );
        assert_eq!(
            create_simulated_eeg_block(0, 0, 500, 0).unwrap_err(),
            "EEG block interval must be positive."
        );
    }
}
```

- [ ] **Step 5: Run Rust EEG tests**

Run:

```powershell
cargo test eeg
```

Working directory:

```text
src-tauri
```

Expected: PASS, EEG tests passing.

- [ ] **Step 6: Commit generator**

```powershell
git add src-tauri/src/eeg.rs src-tauri/src/lib.rs
git commit -m "feat(eeg): add rust simulated eeg generator"
```

---

### Task 3: Add Rust Stream State and Tauri Commands

**Files:**
- Modify: `src-tauri/src/eeg.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Extend Rust EEG module with stream state**

Append this to `src-tauri/src/eeg.rs` above the tests:

```rust
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct EegStreamState {
    worker: Mutex<Option<EegStreamWorker>>,
}

struct EegStreamWorker {
    stop_requested: Arc<AtomicBool>,
}

pub fn start_stream(app: AppHandle, state: &EegStreamState) -> Result<EegStreamInfo, String> {
    let info = default_stream_info();
    let mut worker = state
        .worker
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())?;

    if worker.is_some() {
        return Ok(info);
    }

    let stop_requested = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop_requested);
    let thread_info = info.clone();

    thread::spawn(move || {
        let mut sequence = 0;
        while !stop_for_thread.load(Ordering::Relaxed) {
            let started_at_ms = current_time_ms();
            if let Ok(block) = create_simulated_eeg_block(
                sequence,
                started_at_ms,
                thread_info.sample_rate_hz,
                thread_info.block_interval_ms,
            ) {
                let _ = app.emit(EEG_SAMPLE_BLOCK_EVENT, block);
            }

            sequence += 1;
            thread::sleep(Duration::from_millis(thread_info.block_interval_ms));
        }
    });

    *worker = Some(EegStreamWorker { stop_requested });
    Ok(info)
}

pub fn stop_stream(state: &EegStreamState) -> Result<(), String> {
    let mut worker = state
        .worker
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())?;

    if let Some(worker) = worker.take() {
        worker.stop_requested.store(true, Ordering::Relaxed);
    }

    Ok(())
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}
```

If imports conflict because `serde::Serialize` is already at the top, merge imports cleanly.

- [ ] **Step 2: Add Tauri commands**

In `src-tauri/src/lib.rs`, import:

```rust
use eeg::{EegStreamInfo, EegStreamState};
```

Add commands:

```rust
#[tauri::command]
fn start_eeg_stream(
    app: tauri::AppHandle,
    state: State<'_, EegStreamState>,
) -> Result<EegStreamInfo, String> {
    eeg::start_stream(app, &state)
}

#[tauri::command]
fn stop_eeg_stream(state: State<'_, EegStreamState>) -> Result<(), String> {
    eeg::stop_stream(&state)
}
```

In `run()`, add:

```rust
.manage(EegStreamState::default())
```

Add both commands to `generate_handler!`:

```rust
start_eeg_stream,
stop_eeg_stream
```

- [ ] **Step 3: Run Rust tests**

Run:

```powershell
cargo test
```

Working directory:

```text
src-tauri
```

Expected: all Rust tests pass.

- [ ] **Step 4: Commit stream commands**

```powershell
git add src-tauri/src/eeg.rs src-tauri/src/lib.rs
git commit -m "feat(eeg): stream simulated eeg over tauri"
```

---

### Task 4: Add Frontend Types, API Wrapper, and Ring Buffer Tests

**Files:**
- Create: `src/eeg/types.ts`
- Create: `src/eeg/channels.ts`
- Create: `src/eeg/eegApi.ts`
- Create: `src/eeg/eegRingBuffer.ts`
- Create: `src/eeg/eegRingBuffer.test.ts`

- [ ] **Step 1: Create failing ring buffer test for backend payloads**

Create `src/eeg/eegRingBuffer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_EEG_CHANNELS } from './channels';
import { EegRingBuffer } from './eegRingBuffer';
import type { EegSampleBlockPayload } from './types';

const makePayload = (
  sequence: number,
  startedAtMs: number,
  samples: number[][],
): EegSampleBlockPayload => ({
  sequence,
  sampleRateHz: 2,
  startedAtMs,
  channelIds: DEFAULT_EEG_CHANNELS.slice(0, samples.length).map((channel) => channel.id),
  samples,
});

describe('EegRingBuffer', () => {
  it('keeps only samples inside the configured time window', () => {
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 2), 2);

    buffer.appendPayload(makePayload(1, 0, [[1, 2], [10, 20]]));
    buffer.appendPayload(makePayload(2, 1000, [[3, 4], [30, 40]]));
    buffer.appendPayload(makePayload(3, 2000, [[5, 6], [50, 60]]));

    const snapshot = buffer.toDisplayData(new Set(['fp1', 'fp2']), 2);

    expect(snapshot.x).toEqual([1, 1.5, 2, 2.5]);
    expect(snapshot.seriesByChannel.fp1).toEqual([3, 4, 5, 6]);
    expect(snapshot.seriesByChannel.fp2).toEqual([30, 40, 50, 60]);
  });

  it('preserves configured channel order when extracting visible channels', () => {
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 3), 2);

    buffer.appendPayload(makePayload(1, 0, [[1, 2], [10, 20], [100, 200]]));

    const snapshot = buffer.toDisplayData(new Set(['f3', 'fp1']), 5);

    expect(snapshot.visibleChannels.map((channel) => channel.id)).toEqual(['fp1', 'f3']);
  });

  it('clears all retained samples on reset', () => {
    const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS.slice(0, 1), 2);

    buffer.appendPayload(makePayload(1, 0, [[1, 2]]));
    buffer.reset();

    const snapshot = buffer.toDisplayData(new Set(['fp1']), 5);

    expect(snapshot.x).toEqual([]);
    expect(snapshot.seriesByChannel.fp1).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- src/eeg/eegRingBuffer.test.ts
```

Expected: FAIL because frontend EEG modules do not exist.

- [ ] **Step 3: Add frontend types**

Create `src/eeg/types.ts`:

```ts
export type EegChannel = {
  id: string;
  label: string;
  unit: 'uV';
};

export type EegStreamInfo = {
  sampleRateHz: number;
  blockIntervalMs: number;
  channelIds: string[];
};

export type EegSampleBlockPayload = {
  sequence: number;
  sampleRateHz: number;
  startedAtMs: number;
  channelIds: string[];
  samples: number[][];
};

export type EegDisplaySettings = {
  timeWindowSeconds: number;
  amplitudeUvPerDiv: number;
  paused: boolean;
  visibleChannelIds: Set<string>;
};

export type EegStreamStatus = 'stopped' | 'connecting' | 'streaming' | 'paused' | 'error';

export type EegDisplaySnapshot = {
  latestSequence: number | null;
  x: number[];
  visibleChannels: EegChannel[];
  seriesByChannel: Record<string, number[]>;
  retainedSampleCount: number;
};
```

- [ ] **Step 4: Add default frontend channels**

Create `src/eeg/channels.ts`:

```ts
import type { EegChannel } from './types';

export const DEFAULT_EEG_CHANNELS: EegChannel[] = [
  { id: 'fp1', label: 'Fp1', unit: 'uV' },
  { id: 'fp2', label: 'Fp2', unit: 'uV' },
  { id: 'f3', label: 'F3', unit: 'uV' },
  { id: 'f4', label: 'F4', unit: 'uV' },
  { id: 'c3', label: 'C3', unit: 'uV' },
  { id: 'c4', label: 'C4', unit: 'uV' },
  { id: 'p3', label: 'P3', unit: 'uV' },
  { id: 'p4', label: 'P4', unit: 'uV' },
  { id: 'o1', label: 'O1', unit: 'uV' },
  { id: 'o2', label: 'O2', unit: 'uV' },
  { id: 'f7', label: 'F7', unit: 'uV' },
  { id: 'f8', label: 'F8', unit: 'uV' },
  { id: 't7', label: 'T7', unit: 'uV' },
  { id: 't8', label: 'T8', unit: 'uV' },
  { id: 'p7', label: 'P7', unit: 'uV' },
  { id: 'p8', label: 'P8', unit: 'uV' },
];
```

- [ ] **Step 5: Add Tauri API wrapper**

Create `src/eeg/eegApi.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { EegSampleBlockPayload, EegStreamInfo } from './types';

export const EEG_SAMPLE_BLOCK_EVENT = 'eeg://sample-block';

export function startEegStream() {
  return invoke<EegStreamInfo>('start_eeg_stream');
}

export function stopEegStream() {
  return invoke<void>('stop_eeg_stream');
}

export function listenToEegSampleBlocks(
  onBlock: (payload: EegSampleBlockPayload) => void,
) {
  return listen<EegSampleBlockPayload>(EEG_SAMPLE_BLOCK_EVENT, (event) => {
    onBlock(event.payload);
  });
}
```

- [ ] **Step 6: Implement ring buffer**

Create `src/eeg/eegRingBuffer.ts`:

```ts
import type { EegChannel, EegDisplaySnapshot, EegSampleBlockPayload } from './types';

type RetainedSample = {
  sequence: number;
  timeSeconds: number;
  valuesByChannel: Record<string, number>;
};

export class EegRingBuffer {
  private readonly channels: EegChannel[];
  private readonly fallbackSampleRateHz: number;
  private samples: RetainedSample[] = [];

  constructor(channels: EegChannel[], fallbackSampleRateHz: number) {
    if (channels.length === 0) {
      throw new Error('EEG channel list cannot be empty.');
    }
    if (fallbackSampleRateHz <= 0) {
      throw new Error('EEG sample rate must be positive.');
    }

    this.channels = channels;
    this.fallbackSampleRateHz = fallbackSampleRateHz;
  }

  appendPayload(payload: EegSampleBlockPayload) {
    const sampleRateHz = payload.sampleRateHz > 0 ? payload.sampleRateHz : this.fallbackSampleRateHz;
    const sampleCount = payload.samples[0]?.length ?? 0;

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const valuesByChannel: Record<string, number> = {};

      payload.channelIds.forEach((channelId, channelIndex) => {
        valuesByChannel[channelId] = payload.samples[channelIndex]?.[sampleIndex] ?? 0;
      });

      this.samples.push({
        sequence: payload.sequence,
        timeSeconds: payload.startedAtMs / 1000 + sampleIndex / sampleRateHz,
        valuesByChannel,
      });
    }
  }

  reset() {
    this.samples = [];
  }

  toDisplayData(visibleChannelIds: Set<string>, timeWindowSeconds: number): EegDisplaySnapshot {
    if (timeWindowSeconds <= 0) {
      throw new Error('EEG time window must be positive.');
    }

    this.trimToWindow(timeWindowSeconds);

    const visibleChannels = this.channels.filter((channel) => visibleChannelIds.has(channel.id));
    const seriesByChannel = Object.fromEntries(
      visibleChannels.map((channel) => [channel.id, [] as number[]]),
    );

    this.samples.forEach((sample) => {
      visibleChannels.forEach((channel) => {
        seriesByChannel[channel.id].push(sample.valuesByChannel[channel.id] ?? 0);
      });
    });

    return {
      latestSequence: this.samples.at(-1)?.sequence ?? null,
      x: this.samples.map((sample) => Number(sample.timeSeconds.toFixed(3))),
      visibleChannels,
      seriesByChannel,
      retainedSampleCount: this.samples.length,
    };
  }

  private trimToWindow(timeWindowSeconds: number) {
    const latest = this.samples.at(-1)?.timeSeconds;

    if (latest === undefined) {
      return;
    }

    const minTime = latest - timeWindowSeconds;
    this.samples = this.samples.filter((sample) => sample.timeSeconds > minTime);
  }
}
```

- [ ] **Step 7: Run frontend tests**

Run:

```powershell
npm test -- src/eeg/eegRingBuffer.test.ts
```

Expected: PASS, 3 tests passing.

- [ ] **Step 8: Commit frontend data layer**

```powershell
git add src/eeg/types.ts src/eeg/channels.ts src/eeg/eegApi.ts src/eeg/eegRingBuffer.ts src/eeg/eegRingBuffer.test.ts
git commit -m "feat(eeg): add frontend stream buffer"
```

---

### Task 5: Add Frontend Realtime Hook for Rust Events

**Files:**
- Create: `src/eeg/useRealtimeEeg.ts`

- [ ] **Step 1: Create realtime hook**

Create `src/eeg/useRealtimeEeg.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_EEG_CHANNELS } from './channels';
import { EegRingBuffer } from './eegRingBuffer';
import { listenToEegSampleBlocks, startEegStream, stopEegStream } from './eegApi';
import type { EegDisplaySettings, EegDisplaySnapshot, EegStreamInfo, EegStreamStatus } from './types';

const DEFAULT_SAMPLE_RATE_HZ = 500;
const DEFAULT_WINDOW_SECONDS = 10;
const DEFAULT_SCALE_UV = 100;

export function useRealtimeEeg() {
  const channels = DEFAULT_EEG_CHANNELS;
  const bufferRef = useRef(new EegRingBuffer(channels, DEFAULT_SAMPLE_RATE_HZ));
  const [streamInfo, setStreamInfo] = useState<EegStreamInfo | null>(null);
  const [status, setStatus] = useState<EegStreamStatus>('stopped');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState<EegDisplaySettings>(() => ({
    timeWindowSeconds: DEFAULT_WINDOW_SECONDS,
    amplitudeUvPerDiv: DEFAULT_SCALE_UV,
    paused: false,
    visibleChannelIds: new Set(channels.map((channel) => channel.id)),
  }));
  const [snapshot, setSnapshot] = useState<EegDisplaySnapshot>(() => (
    bufferRef.current.toDisplayData(new Set(channels.map((channel) => channel.id)), DEFAULT_WINDOW_SECONDS)
  ));

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    listenToEegSampleBlocks((payload) => {
      if (!disposed && !settings.paused) {
        bufferRef.current.appendPayload(payload);
      }
    })
      .then((nextUnlisten) => {
        unlisten = nextUnlisten;
      })
      .catch((error) => {
        setStatus('error');
        setErrorMessage(typeof error === 'string' ? error : 'Failed to subscribe to EEG stream.');
      });

    return () => {
      disposed = true;
      unlisten?.();
      void stopEegStream();
    };
  }, [settings.paused]);

  useEffect(() => {
    let frame = 0;

    const tick = () => {
      setSnapshot(bufferRef.current.toDisplayData(
        settings.visibleChannelIds,
        settings.timeWindowSeconds,
      ));
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frame);
  }, [settings.timeWindowSeconds, settings.visibleChannelIds]);

  const start = useCallback(async () => {
    setStatus('connecting');
    setErrorMessage(null);

    try {
      const info = await startEegStream();
      setStreamInfo(info);
      setStatus(settings.paused ? 'paused' : 'streaming');
    } catch (error) {
      setStatus('error');
      setErrorMessage(typeof error === 'string' ? error : 'Failed to start EEG stream.');
    }
  }, [settings.paused]);

  const stop = useCallback(async () => {
    try {
      await stopEegStream();
      setStatus('stopped');
    } catch (error) {
      setStatus('error');
      setErrorMessage(typeof error === 'string' ? error : 'Failed to stop EEG stream.');
    }
  }, []);

  const setPaused = useCallback((paused: boolean) => {
    setSettings((current) => ({ ...current, paused }));
    setStatus((current) => {
      if (current === 'streaming' || current === 'paused') {
        return paused ? 'paused' : 'streaming';
      }
      return current;
    });
  }, []);

  const setTimeWindowSeconds = useCallback((timeWindowSeconds: number) => {
    setSettings((current) => ({ ...current, timeWindowSeconds }));
  }, []);

  const setAmplitudeUvPerDiv = useCallback((amplitudeUvPerDiv: number) => {
    setSettings((current) => ({ ...current, amplitudeUvPerDiv }));
  }, []);

  const toggleChannel = useCallback((channelId: string) => {
    setSettings((current) => {
      const visibleChannelIds = new Set(current.visibleChannelIds);

      if (visibleChannelIds.has(channelId)) {
        visibleChannelIds.delete(channelId);
      } else {
        visibleChannelIds.add(channelId);
      }

      return { ...current, visibleChannelIds };
    });
  }, []);

  const reset = useCallback(() => {
    bufferRef.current.reset();
    setSnapshot(bufferRef.current.toDisplayData(
      settings.visibleChannelIds,
      settings.timeWindowSeconds,
    ));
  }, [settings.timeWindowSeconds, settings.visibleChannelIds]);

  return useMemo(() => ({
    channels,
    errorMessage,
    sampleRateHz: streamInfo?.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ,
    settings,
    snapshot,
    start,
    status,
    stop,
    reset,
    setAmplitudeUvPerDiv,
    setPaused,
    setTimeWindowSeconds,
    toggleChannel,
  }), [
    channels,
    errorMessage,
    reset,
    setAmplitudeUvPerDiv,
    setPaused,
    setTimeWindowSeconds,
    settings,
    snapshot,
    start,
    status,
    stop,
    streamInfo?.sampleRateHz,
    toggleChannel,
  ]);
}
```

- [ ] **Step 2: Run build**

Run:

```powershell
npm run build
```

Expected: TypeScript compile succeeds.

- [ ] **Step 3: Commit hook**

```powershell
git add src/eeg/useRealtimeEeg.ts
git commit -m "feat(eeg): subscribe to rust eeg stream"
```

---

### Task 6: Add Controls, Channel List, and uPlot Panel

**Files:**
- Create: `src/eeg/EegControls.tsx`
- Create: `src/eeg/EegChannelList.tsx`
- Create: `src/eeg/EegWaveformPanel.tsx`
- Create: `src/pages/home/EegAcquisition.module.css`

- [ ] **Step 1: Create controls**

Create `src/eeg/EegControls.tsx`:

```tsx
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import PowerSettingsNewRoundedIcon from '@mui/icons-material/PowerSettingsNewRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import { Button, MenuItem, TextField } from '@mui/material';
import styles from '../pages/home/EegAcquisition.module.css';

type Props = {
  amplitudeUvPerDiv: number;
  paused: boolean;
  timeWindowSeconds: number;
  onAmplitudeChange: (value: number) => void;
  onPauseChange: (value: boolean) => void;
  onReset: () => void;
  onStart: () => void;
  onStop: () => void;
  onTimeWindowChange: (value: number) => void;
};

export default function EegControls({
  amplitudeUvPerDiv,
  paused,
  timeWindowSeconds,
  onAmplitudeChange,
  onPauseChange,
  onReset,
  onStart,
  onStop,
  onTimeWindowChange,
}: Props) {
  return (
    <div className={styles.controlStrip}>
      <Button className={styles.controlButton} variant="contained" startIcon={<PowerSettingsNewRoundedIcon />} onClick={onStart}>
        Start
      </Button>
      <Button className={styles.controlButton} variant="outlined" startIcon={<StopRoundedIcon />} onClick={onStop}>
        Stop
      </Button>
      <Button className={styles.controlButton} variant="outlined" startIcon={paused ? <PlayArrowRoundedIcon /> : <PauseRoundedIcon />} onClick={() => onPauseChange(!paused)}>
        {paused ? 'Resume Display' : 'Pause Display'}
      </Button>
      <Button className={styles.controlButton} variant="outlined" startIcon={<RestartAltRoundedIcon />} onClick={onReset}>
        Reset
      </Button>
      <TextField className={styles.controlSelect} select size="small" label="Window" value={timeWindowSeconds} onChange={(event) => onTimeWindowChange(Number(event.target.value))}>
        {[5, 10, 30].map((value) => <MenuItem key={value} value={value}>{value}s</MenuItem>)}
      </TextField>
      <TextField className={styles.controlSelect} select size="small" label="Scale" value={amplitudeUvPerDiv} onChange={(event) => onAmplitudeChange(Number(event.target.value))}>
        {[50, 100, 200, 500].map((value) => <MenuItem key={value} value={value}>{value} uV/div</MenuItem>)}
      </TextField>
    </div>
  );
}
```

- [ ] **Step 2: Create channel list**

Create `src/eeg/EegChannelList.tsx`:

```tsx
import { Checkbox, FormControlLabel } from '@mui/material';
import type { EegChannel } from './types';
import styles from '../pages/home/EegAcquisition.module.css';

type Props = {
  channels: EegChannel[];
  visibleChannelIds: Set<string>;
  onToggleChannel: (channelId: string) => void;
};

export default function EegChannelList({ channels, visibleChannelIds, onToggleChannel }: Props) {
  return (
    <aside className={styles.channelPanel} aria-label="EEG channel visibility">
      <div className={styles.panelTitle}>Channels</div>
      <div className={styles.channelToggleGrid}>
        {channels.map((channel) => (
          <FormControlLabel
            key={channel.id}
            className={styles.channelToggle}
            control={<Checkbox size="small" checked={visibleChannelIds.has(channel.id)} onChange={() => onToggleChannel(channel.id)} />}
            label={channel.label}
          />
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Create waveform panel**

Create `src/eeg/EegWaveformPanel.tsx`:

```tsx
import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { EegDisplaySnapshot } from './types';
import styles from '../pages/home/EegAcquisition.module.css';

type Props = {
  amplitudeUvPerDiv: number;
  snapshot: EegDisplaySnapshot;
};

type UplotData = [number[], ...number[][]];

const TRACE_COLORS = ['#ff6f61', '#34a853', '#4285f4', '#fbbc04'];

export default function EegWaveformPanel({ amplitudeUvPerDiv, snapshot }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  const data = useMemo<UplotData>(() => {
    const laneHeight = amplitudeUvPerDiv * 2.5;
    const series = snapshot.visibleChannels.map((channel, channelIndex) => {
      const laneOffset = -channelIndex * laneHeight;
      return (snapshot.seriesByChannel[channel.id] ?? []).map((value) => value + laneOffset);
    });

    return [snapshot.x, ...series];
  }, [amplitudeUvPerDiv, snapshot]);

  useEffect(() => {
    const host = hostRef.current;

    if (!host || plotRef.current) {
      return;
    }

    const plot = new uPlot({
      width: host.clientWidth,
      height: host.clientHeight,
      cursor: { show: false },
      legend: { show: false },
      scales: {
        x: { time: false },
        y: {
          auto: false,
          range: () => [
            -(snapshot.visibleChannels.length + 1) * amplitudeUvPerDiv * 2.5,
            amplitudeUvPerDiv * 2,
          ],
        },
      },
      axes: [
        {
          stroke: '#6f777d',
          grid: { stroke: 'rgba(111, 119, 125, 0.16)' },
        },
        { show: false },
      ],
      series: [
        {},
        ...snapshot.visibleChannels.map((channel, index) => ({
          label: channel.label,
          stroke: TRACE_COLORS[index % TRACE_COLORS.length],
          width: 1,
          points: { show: false },
        })),
      ],
    }, data, host);

    plotRef.current = plot;

    const observer = new ResizeObserver(() => {
      plot.setSize({
        width: host.clientWidth,
        height: host.clientHeight,
      });
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, []);

  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  return (
    <section className={styles.waveformPanel} aria-label="Realtime EEG waveform">
      <div className={styles.channelRail} aria-hidden="true">
        {snapshot.visibleChannels.map((channel) => (
          <span key={channel.id}>{channel.label}</span>
        ))}
        <span>TRG</span>
      </div>
      <div ref={hostRef} className={styles.plotHost} />
    </section>
  );
}
```

- [ ] **Step 4: Create minimal CSS classes**

Create `src/pages/home/EegAcquisition.module.css`:

```css
.workspace {
  color: #172026;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  width: 100%;
}

.header {
  align-items: flex-start;
  display: flex;
  gap: 18px;
  justify-content: space-between;
}

.eyebrow {
  color: rgba(23, 32, 38, 0.58);
  font-size: 12px;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.title {
  color: #172026;
  font-size: 30px;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.05;
  margin: 4px 0 0;
}

.statusBar {
  align-items: center;
  color: rgba(23, 32, 38, 0.68);
  display: flex;
  flex-wrap: wrap;
  font-size: 13px;
  font-weight: 650;
  gap: 10px;
  justify-content: flex-end;
}

.statusPill {
  align-items: center;
  background: rgba(34, 139, 94, 0.12);
  border: 1px solid rgba(34, 139, 94, 0.24);
  border-radius: 8px;
  color: #17633f;
  display: inline-flex;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  text-transform: capitalize;
}

.stopped {
  background: rgba(84, 96, 104, 0.12);
  border-color: rgba(84, 96, 104, 0.24);
  color: #46525a;
}

.connecting {
  background: rgba(45, 113, 184, 0.12);
  border-color: rgba(45, 113, 184, 0.24);
  color: #245f9d;
}

.streaming {
  background: rgba(34, 139, 94, 0.12);
  border-color: rgba(34, 139, 94, 0.24);
  color: #17633f;
}

.paused {
  background: rgba(194, 121, 20, 0.12);
  border-color: rgba(194, 121, 20, 0.24);
  color: #8a560e;
}

.error {
  background: rgba(184, 45, 45, 0.12);
  border-color: rgba(184, 45, 45, 0.24);
  color: #8d1e1e;
}

.errorMessage {
  background: rgba(184, 45, 45, 0.08);
  border: 1px solid rgba(184, 45, 45, 0.18);
  border-radius: 8px;
  color: #8d1e1e;
  font-size: 13px;
  font-weight: 650;
  padding: 10px 12px;
}

.controlStrip {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.controlButton {
  border-radius: 8px;
  min-height: 38px;
  text-transform: none;
}

.controlSelect {
  min-width: 132px;
}

.monitorGrid {
  display: grid;
  gap: 14px;
  grid-template-columns: minmax(0, 1fr) 190px;
  min-height: 520px;
}

.waveformPanel {
  background: #10171c;
  border: 1px solid rgba(23, 32, 38, 0.18);
  border-radius: 8px;
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  min-height: 520px;
  overflow: hidden;
}

.channelRail {
  background: #162027;
  color: rgba(235, 243, 247, 0.78);
  display: grid;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  grid-auto-rows: 1fr;
  padding: 12px 8px;
}

.channelRail span {
  align-items: center;
  display: flex;
  min-height: 22px;
}

.plotHost {
  min-height: 0;
  min-width: 0;
}

.plotHost :global(.uplot) {
  background: #10171c;
}

.channelPanel {
  background: rgba(255, 255, 255, 0.68);
  border: 1px solid rgba(23, 32, 38, 0.1);
  border-radius: 8px;
  min-width: 0;
  padding: 14px;
}

.panelTitle {
  color: #172026;
  font-size: 13px;
  font-weight: 760;
  margin-bottom: 10px;
}

.channelToggleGrid {
  display: grid;
  gap: 2px;
}

.channelToggle {
  margin: 0;
}

.footer {
  color: rgba(23, 32, 38, 0.62);
  display: flex;
  flex-wrap: wrap;
  font-size: 12px;
  font-weight: 650;
  gap: 12px;
}

@media (max-width: 980px) {
  .monitorGrid {
    grid-template-columns: 1fr;
  }

  .channelPanel {
    order: -1;
  }

  .channelToggleGrid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
```

- [ ] **Step 5: Run build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite build succeed.

- [ ] **Step 6: Commit UI building blocks**

```powershell
git add src/eeg/EegControls.tsx src/eeg/EegChannelList.tsx src/eeg/EegWaveformPanel.tsx src/pages/home/EegAcquisition.module.css
git commit -m "feat(eeg): add realtime monitor controls"
```

---

### Task 7: Replace EEG Acquisition Route

**Files:**
- Modify: `src/pages/home/EegAcquisition.tsx`
- Modify: `src/pages/home/EegAcquisition.module.css`

- [ ] **Step 1: Compose route**

Replace `src/pages/home/EegAcquisition.tsx` with a workspace that:

- calls `useRealtimeEeg()`,
- renders header status and sample rate,
- renders `EegControls`,
- renders `EegWaveformPanel`,
- renders `EegChannelList`,
- displays error text when `errorMessage` exists,
- displays latest sequence and retained sample count in the footer.

Use this structure:

```tsx
import ActivityRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import EegChannelList from '../../eeg/EegChannelList';
import EegControls from '../../eeg/EegControls';
import EegWaveformPanel from '../../eeg/EegWaveformPanel';
import { useRealtimeEeg } from '../../eeg/useRealtimeEeg';
import styles from './EegAcquisition.module.css';

export default function EegAcquisition() {
  const eeg = useRealtimeEeg();
  const visibleCount = eeg.settings.visibleChannelIds.size;

  return (
    <section className={styles.workspace} aria-label="EEG acquisition workspace">
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Acquisition Monitor</div>
          <h1 className={styles.title}>Realtime EEG</h1>
        </div>
        <div className={styles.statusBar}>
          <span className={`${styles.statusPill} ${styles[eeg.status]}`}>
            <ActivityRoundedIcon fontSize="small" />
            {eeg.status}
          </span>
          <span>{eeg.sampleRateHz} Hz</span>
          <span>{visibleCount}/{eeg.channels.length} channels</span>
        </div>
      </header>

      <EegControls
        amplitudeUvPerDiv={eeg.settings.amplitudeUvPerDiv}
        paused={eeg.settings.paused}
        timeWindowSeconds={eeg.settings.timeWindowSeconds}
        onAmplitudeChange={eeg.setAmplitudeUvPerDiv}
        onPauseChange={eeg.setPaused}
        onReset={eeg.reset}
        onStart={eeg.start}
        onStop={eeg.stop}
        onTimeWindowChange={eeg.setTimeWindowSeconds}
      />

      {eeg.errorMessage ? <div className={styles.errorMessage}>{eeg.errorMessage}</div> : null}

      <div className={styles.monitorGrid}>
        <EegWaveformPanel amplitudeUvPerDiv={eeg.settings.amplitudeUvPerDiv} snapshot={eeg.snapshot} />
        <EegChannelList channels={eeg.channels} visibleChannelIds={eeg.settings.visibleChannelIds} onToggleChannel={eeg.toggleChannel} />
      </div>

      <footer className={styles.footer}>
        <span>Window {eeg.settings.timeWindowSeconds}s</span>
        <span>Scale {eeg.settings.amplitudeUvPerDiv} uV/div</span>
        <span>Buffered {eeg.snapshot.retainedSampleCount} samples</span>
        <span>Sequence {eeg.snapshot.latestSequence ?? '-'}</span>
      </footer>
    </section>
  );
}
```

- [ ] **Step 2: Confirm CSS is present**

Confirm `src/pages/home/EegAcquisition.module.css` contains the full route, control, waveform, status, error, channel panel, footer, and responsive classes added in Task 6. No additional CSS is required in this step unless build or manual inspection exposes a layout defect.

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite build succeed.

- [ ] **Step 4: Commit route integration**

```powershell
git add src/pages/home/EegAcquisition.tsx src/pages/home/EegAcquisition.module.css
git commit -m "feat(eeg): build rust-backed acquisition monitor"
```

---

### Task 8: Final Verification

**Files:**
- No code changes expected unless verification finds defects.

- [ ] **Step 1: Run Rust tests**

Run:

```powershell
cargo test
```

Working directory:

```text
src-tauri
```

Expected: all Rust tests pass.

- [ ] **Step 2: Run frontend tests**

Run:

```powershell
npm test
```

Expected: all Vitest tests pass.

- [ ] **Step 3: Run production build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite build succeeds. Existing chunk-size warning is acceptable.

- [ ] **Step 4: Manual UI check in Tauri**

Run:

```powershell
npm run tauri dev
```

Sign in, then open `/eeg-acquisition`.

Verify:

- Header shows `Realtime EEG`.
- Pressing Start changes status to `streaming`.
- 16 channel labels appear.
- Traces scroll continuously from Rust events.
- Pause Display freezes visible buffer without requiring frontend sample generation.
- Resume Display continues appending backend event blocks.
- Stop changes status to `stopped`.
- Reset clears visible samples.
- Window selector changes retained sample count after a few seconds.
- Scale selector changes vertical amplitude.
- Channel checkboxes hide/show traces without collapsing the plot.

- [ ] **Step 5: Commit verification fixes**

If verification required fixes:

```powershell
git add <changed-files>
git commit -m "fix(eeg): stabilize rust-backed monitor"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: The plan now makes Rust the data source, adds Tauri events/commands, keeps the frontend display-only, and covers ring buffer/uPlot rendering.
- Scope: Real EEG hardware, file recording, and advanced filters are intentionally excluded.
- Testing: Rust generator is covered by `cargo test`; frontend buffer is covered by Vitest; event wiring and visual behavior require Tauri manual verification.
