# Realtime EEG Monitor Design

## Goal

Build the first usable EEG Acquisition workspace as a BioSemi ActiView-inspired realtime EEG monitor. The first version uses a Rust/Tauri simulated EEG stream so the app architecture matches the future real-device model: backend owns acquisition, frontend only renders incoming data.

## Core Constraint

EEG sample generation must happen in the Rust backend.

The React frontend must not synthesize EEG samples. It may only:

- request stream start/stop through Tauri commands,
- subscribe to Tauri events,
- buffer received sample blocks for display,
- render and control the visualization.

This keeps the first simulated implementation aligned with future hardware integration, where Rust will read from the device driver or SDK.

## Scope

This spec covers the first implementation slice only:

- Replace the current simple `EegAcquisition` route with a realtime monitor UI.
- Add a Rust EEG stream module that generates 16-channel simulated EEG blocks.
- Emit sample blocks from Rust to the frontend through Tauri events.
- Render the received stream in a stacked scrolling waveform view.
- Provide basic controls for start/stop, pause display, reset display buffer, time window, amplitude scale, and channel visibility.

Out of scope for the first slice:

- Real EEG hardware connection.
- BDF/EDF recording.
- Clinical interpretation, diagnosis, or medical claims.
- Advanced DSP filters beyond display scaling and optional DC offset removal.
- Frontend-generated EEG sample data.

## Recommended Rendering Library

Use `uplot` for the first version.

Rationale:

- It is lightweight and suitable for dense time-series rendering in a React/Tauri app.
- Canvas rendering is enough for the first target: 16 channels, 500 Hz, 10 second window.
- It keeps licensing and integration simple.
- The rendering layer can later be replaced by LightningChart JS or a custom WebGL renderer if the app needs 64+ channels at higher sampling rates.

Do not use ECharts for the raw EEG trace panel in this slice. It can be useful later for summary charts, spectra, trends, and dashboard views, but the raw stacked waveform monitor needs tighter control over rendering and memory.

## Backend Stream Model

Add a Rust module responsible for simulated acquisition:

- `src-tauri/src/eeg.rs`
- owns stream lifecycle state,
- validates requested stream settings,
- generates deterministic sample blocks,
- emits `eeg://sample-block` events to the frontend,
- supports start and stop commands.

Default stream settings:

- 16 channels.
- 500 Hz.
- 50 ms block interval.
- 25 samples per channel per block.

Rust event payload:

```rust
pub struct EegSampleBlockPayload {
    pub sequence: u64,
    pub sample_rate_hz: u32,
    pub started_at_ms: i64,
    pub channel_ids: Vec<String>,
    pub samples: Vec<Vec<f32>>,
}
```

Tauri commands:

- `start_eeg_stream() -> Result<EegStreamInfo, String>`
- `stop_eeg_stream() -> Result<(), String>`

The backend should prevent duplicate stream tasks. Calling `start_eeg_stream` while streaming should return current stream info rather than spawning another loop.

## Frontend Data Model

Define frontend types around received backend blocks:

```ts
export type EegChannel = {
  id: string;
  label: string;
  unit: 'uV';
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
```

The frontend may convert `number[][]` payloads into typed arrays or compact arrays for buffering, but it must not create sample values itself.

## Data Flow

1. `EegAcquisition` mounts.
2. Frontend calls `start_eeg_stream`.
3. Rust starts or reuses a backend simulated stream task.
4. Rust emits `eeg://sample-block` every 50 ms.
5. Frontend subscribes with `@tauri-apps/api/event`.
6. Incoming blocks are appended to a frontend ring buffer.
7. A render loop reads the ring buffer at animation-frame cadence.
8. uPlot renders the current visible time window.
9. On route unmount, frontend calls `stop_eeg_stream` and unsubscribes.

Display pause is a frontend-only display control for this slice:

- paused display stops appending incoming blocks to the visible buffer,
- backend streaming may continue unless the user presses a future hard stop control,
- start/stop controls manage backend stream lifecycle.

## Visual Model

The monitor should feel closer to acquisition software than a marketing dashboard:

- Dense, work-focused layout.
- A large central waveform surface.
- Channel labels pinned on the left.
- Realtime status and controls around the waveform, not decorative cards.
- Stable dimensions so controls and labels do not shift while streaming.

BioSemi ActiView-inspired behavior for this slice:

- Stacked traces, one horizontal lane per channel.
- Fixed recent time window, default 10 seconds.
- Amplitude scale selector, default `100 uV/div`.
- Sample rate, backend stream status, and active channel count visible.
- Display pause/resume without losing the current visible buffer.
- Empty event/trigger lane reserved at the bottom.

## UI Layout

The `EEG Acquisition` route should become a full workspace:

- Header bar: title, backend stream status, sample rate, active channel count.
- Control strip: start, stop, display pause/resume, reset display buffer, time window selector, amplitude scale selector.
- Main waveform area: stacked realtime traces.
- Channel rail: channel names such as `Fp1`, `Fp2`, `F3`, `F4`, `C3`, `C4`, `P3`, `P4`, `O1`, `O2`, `F7`, `F8`, `T7`, `T8`, `P7`, `P8`.
- Optional right panel or compact drawer: channel visibility toggles.
- Bottom status row: buffer length, latest sequence, and trigger lane.

Use a restrained acquisition-tool palette. Avoid hero-style panels and large decorative content on this route.

## Components

Backend:

- `src-tauri/src/eeg.rs`: simulated stream lifecycle and block generation.
- `src-tauri/src/lib.rs`: expose `start_eeg_stream` and `stop_eeg_stream` commands and manage EEG stream state.

Frontend:

- `src/pages/home/EegAcquisition.tsx`: route composition and workspace state.
- `src/eeg/types.ts`: shared frontend EEG display and event payload types.
- `src/eeg/channels.ts`: default 16-channel montage labels.
- `src/eeg/eegApi.ts`: Tauri command/event wrapper.
- `src/eeg/eegRingBuffer.ts`: fixed-window channel buffer.
- `src/eeg/useRealtimeEeg.ts`: command/event lifecycle and display-state hook.
- `src/eeg/EegWaveformPanel.tsx`: uPlot integration and waveform rendering.
- `src/eeg/EegControls.tsx`: start, stop, pause display, reset, time window, scale controls.
- `src/eeg/EegChannelList.tsx`: channel visibility controls.
- `src/pages/home/EegAcquisition.module.css`: route-specific layout.

Keep the backend stream, frontend subscription, and rendering integration isolated from each other so real hardware can later replace only the Rust stream producer.

## Performance Targets

First slice:

- 16 channels.
- 500 Hz backend sample rate.
- 50 ms backend event block interval.
- 10 second default display window.
- 30 FPS minimum on a normal development machine.
- No unbounded frontend array growth while the stream runs for several minutes.

Implementation rule: no per-sample React state updates. Samples live in Rust event blocks and frontend buffer structures; React state stores controls and display metadata.

## Error Handling

Backend:

- Reject invalid sample rates, channel lists, and block intervals.
- Prevent duplicate stream worker tasks.
- Return clear errors if stream state cannot be locked.

Frontend:

- Show `connecting`, `streaming`, `paused`, `stopped`, and `error` states.
- If event subscription fails, show an error state and keep controls usable.
- On route unmount, attempt cleanup but do not block navigation on stop errors.

## Testing Strategy

Rust tests:

- Simulated block generator returns expected channel count and sample count.
- Generated values are deterministic for the same sequence and channel.
- Stream state refuses invalid configuration.

Frontend unit tests:

- Ring buffer keeps only the configured time window.
- Appending backend payload blocks preserves channel order.
- Reset clears sample data.

Build verification:

- `cargo test`
- `npm run build`

Manual verification:

- Open `/eeg-acquisition`.
- Start the stream.
- Confirm traces scroll continuously from backend events.
- Pause display freezes the visible buffer.
- Resume display continues appending received blocks.
- Stop changes backend stream status.
- Reset clears visible samples.
- Time window and amplitude controls visibly affect the waveform.
- Channel toggles hide and restore traces without layout collapse.

## Implementation Sequence

1. Add `uplot` and frontend test tooling.
2. Add Rust EEG types, generator, stream state, and tests.
3. Expose Tauri start/stop commands and sample-block event emission.
4. Add frontend EEG types and Tauri API wrapper.
5. Build and test the frontend ring buffer for backend payloads.
6. Implement frontend realtime hook that subscribes to Rust events.
7. Implement uPlot waveform panel and controls.
8. Replace the current simple `EegAcquisition` route with the acquisition workspace.
9. Verify Rust tests, frontend build, and manual streaming behavior.

## Defaults

- Channel count: 16.
- Sample rate: 500 Hz.
- Backend block interval: 50 ms.
- Default display window: 10 seconds.
- Default scale: `100 uV/div`.
- Theme: acquisition-tool style, dense and readable, integrated with the current home shell.
