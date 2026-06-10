# Realtime EEG Monitor Design

## Goal

Build the first usable EEG Acquisition workspace as a BioSemi ActiView-inspired realtime EEG monitor. The first version uses simulated EEG data so the UI, buffering, scaling, and rendering model can be validated before hardware integration.

## Scope

This spec covers the first implementation slice only:

- Replace the current simple `EegAcquisition` route with a realtime monitor UI.
- Render 16 simulated EEG channels in a stacked scrolling waveform view.
- Provide basic controls for pause/resume, time window, amplitude scale, and channel visibility.
- Keep data flow isolated so a real Tauri device source can replace the simulator later.

Out of scope for the first slice:

- Real EEG hardware connection.
- BDF/EDF recording.
- Clinical interpretation, diagnosis, or medical claims.
- Advanced DSP filters beyond lightweight display scaling and optional DC offset removal.

## Recommended Library

Use `uplot` for the first version.

Rationale:

- It is lightweight and suitable for dense time-series rendering in a React/Tauri app.
- Canvas rendering is enough for the first target: 16 channels, 250-500 Hz, 10 second window.
- It keeps licensing and integration simple.
- The rendering layer can later be replaced by LightningChart JS or a custom WebGL renderer if the app needs 64+ channels at higher sampling rates.

Do not use ECharts for the raw EEG trace panel in this slice. It can be useful later for summary charts, spectra, trends, and dashboard views, but the raw stacked waveform monitor needs tighter control over rendering and memory.

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
- Sample rate and stream status visible.
- Pause/resume without losing the current visible buffer.
- Event/trigger row reserved at the bottom, even if first version only displays an empty trigger lane.

## UI Layout

The `EEG Acquisition` route should become a full workspace:

- Header bar: title, stream status, sample rate, active channel count.
- Control strip: pause/resume, reset, time window selector, amplitude scale selector.
- Main waveform area: stacked realtime traces.
- Channel rail: channel names such as `Fp1`, `Fp2`, `F3`, `F4`, `C3`, `C4`, `P3`, `P4`, `O1`, `O2`, `F7`, `F8`, `T7`, `T8`, `P7`, `P8`.
- Optional right panel or compact drawer: channel visibility toggles.
- Bottom status row: buffer length, dropped frame count if tracked, and trigger lane.

Use a restrained acquisition-tool palette. Avoid hero-style panels and large decorative content on this route.

## Data Model

Define frontend types around raw sample blocks instead of individual React state updates:

```ts
export type EegChannel = {
  id: string;
  label: string;
  unit: 'uV';
};

export type EegSampleBlock = {
  sequence: number;
  sampleRateHz: number;
  startedAtMs: number;
  channelIds: string[];
  samples: Float32Array[];
};

export type EegDisplaySettings = {
  timeWindowSeconds: number;
  amplitudeUvPerDiv: number;
  paused: boolean;
  visibleChannelIds: Set<string>;
};
```

The simulator should emit blocks rather than single samples. A reasonable first block size is 50 ms of data. At 500 Hz, that is 25 samples per channel per block.

## Data Flow

First version:

1. `EegAcquisition` mounts.
2. A simulated EEG source starts producing `EegSampleBlock` objects.
3. Blocks are appended to a ring buffer.
4. A render loop reads from the ring buffer at animation-frame cadence.
5. uPlot receives compact arrays for the current time window.
6. React state stores controls and metadata only; it does not store every sample.

Future hardware version:

1. Rust/Tauri device code emits sample blocks through Tauri events.
2. The same frontend ring buffer accepts real blocks.
3. The simulator remains available as demo mode and as a development fallback.

## Components

Create focused frontend modules:

- `src/pages/home/EegAcquisition.tsx`: route composition and workspace state.
- `src/eeg/types.ts`: shared EEG display and sample types.
- `src/eeg/simulatedEegSource.ts`: deterministic simulated EEG block generator.
- `src/eeg/eegRingBuffer.ts`: fixed-window channel buffer.
- `src/eeg/useRealtimeEeg.ts`: hook that manages source lifecycle and exposes display data.
- `src/eeg/EegWaveformPanel.tsx`: uPlot integration and waveform rendering.
- `src/eeg/EegControls.tsx`: pause, reset, time window, and scale controls.
- `src/eeg/EegChannelList.tsx`: channel visibility controls.
- `src/pages/home/EegAcquisition.module.css`: route-specific layout.

Keep the rendering integration isolated in `EegWaveformPanel` so the chart library can be swapped later.

## Performance Targets

First slice:

- 16 channels.
- 500 Hz simulated sample rate.
- 10 second default display window.
- 30 FPS minimum on a normal development machine.
- No unbounded array growth while the stream runs for several minutes.

Implementation rule: no per-sample React state updates. Samples live in typed arrays or compact numeric arrays owned by the EEG data layer.

## Error Handling

For the simulator, errors should be limited to invalid configuration:

- Reject empty channel lists.
- Reject non-positive sample rates.
- Reject non-positive time windows.

For future real devices, the same UI should already have states for:

- disconnected
- connecting
- streaming
- paused
- error

## Testing Strategy

Unit tests should cover the non-visual data layer:

- Ring buffer keeps only the configured time window.
- Appending blocks preserves channel order.
- Reset clears sample data.
- Simulator produces expected channel counts and monotonic sequence numbers.

Build verification should cover the React/Tauri frontend:

- `npm run build`

Manual verification for the first visual slice:

- Open `/eeg-acquisition`.
- Confirm traces scroll continuously.
- Pause freezes the display.
- Resume continues streaming.
- Time window and amplitude controls visibly affect the waveform.
- Channel toggles hide and restore traces without layout collapse.

## Implementation Sequence

1. Add `uplot` dependency and any needed TypeScript types.
2. Add EEG domain types.
3. Build and test the ring buffer.
4. Build and test the simulator.
5. Implement the realtime hook.
6. Implement the waveform panel.
7. Replace the current simple `EegAcquisition` route with the acquisition workspace.
8. Verify build and manually inspect the route.

## Open Decisions

For the first implementation, choose these defaults:

- Channel count: 16.
- Sample rate: 500 Hz.
- Default window: 10 seconds.
- Default scale: `100 uV/div`.
- Theme: acquisition-tool style, dense and readable, integrated with the current home shell.

These defaults can be changed later without changing the architecture.
