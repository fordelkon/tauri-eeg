# Rust EEG Device Server Design

## Goal

Move EEG device acquisition fully into the Tauri Rust backend. The existing Flask EEG implementation is a protocol and behavior reference only. Rust will own the TCP server, device start command, frame parsing, realtime display events, recording, session metadata, and user-bound history.

The frontend remains a realtime EEG display. It will receive 32-channel payloads from Rust, but show 16 selected channels at a time. The default visible channels are `ch01` through `ch16`.

## Scope

This design covers:

- A Rust TCP server for the EEG device and trigger device.
- UDP start command dispatch from Rust.
- EEG and trigger binary protocol parsing.
- Packet loss tracking and bounded padding.
- Realtime Tauri event emission using the existing `eeg://sample-block` event.
- User-bound recording sessions.
- Binary recording files plus `metadata.json`.
- EEG session database records tied to the current login user.
- Frontend channel naming and selection from 32 available channels.

This design does not keep Flask in the EEG runtime path. It also does not require HDF5 output for the first Rust implementation.

## Device Protocol

Rust will preserve the protocol behavior from the Flask implementation.

Network binding must preserve the fixed deployment values from
`D:\bciprogram\bci_flask_services\app.py`:

- Host IP: `192.168.1.101`
- TCP server port: `5001`
- EEG device IP: `192.168.1.102`
- Trigger device IP: `192.168.1.103`

These values are hardware/network configuration, not arbitrary defaults. Rust
may expose an optional config object for diagnostics, but the built-in default
must match the Flask values above.

Constants:

- EEG channels: `32`
- EEG bytes per channel: `3`
- EEG start bytes: `A1 05`
- Trigger start bytes: `AA 56`
- Device start instruction: `BB 66 01`

Frame layout:

```text
[START_BYTES: 2][RESERVED_OR_TRIGGER: 1][PACKET_INDEX: 4 big-endian][DATA]
```

EEG data:

- Data length is `32 * 3 = 96` bytes.
- Each channel is a signed 24-bit sample encoded as 3 bytes.
- Decode per channel by copying the 3 bytes, XORing the first byte with `0x80`, interpreting as big-endian unsigned integer, subtracting `8388608`, then multiplying by `0.02483`.
- The resulting unit is microvolts.

Trigger data:

- Trigger value comes from the reserved byte in the trigger frame.
- Trigger frame data length remains 3 bytes for parser alignment.
- Non-zero trigger values are retained as the latest marker value.

## Rust Backend Architecture

The current `src-tauri/src/eeg.rs` simulated stream should be replaced with a small module tree:

```text
src-tauri/src/eeg/
  mod.rs
  protocol.rs
  server.rs
  buffer.rs
  session.rs
  storage.rs
```

`mod.rs` exposes the public API used by Tauri commands:

- start device stream
- stop device stream
- get EEG status
- start recording
- stop recording
- list user EEG sessions

`protocol.rs` owns frame parsing and packet loss tracking. It has deterministic unit tests for valid EEG frames, valid trigger frames, resynchronization after junk bytes, duplicate packet indices, skipped packet indices, and large reset-like gaps.

`server.rs` owns the TCP listener, UDP device start command, accepted socket routing, and worker shutdown. Connections are classified by configured EEG and trigger device IP addresses. Unknown clients are closed.

`buffer.rs` owns realtime sample aggregation. It receives decoded 32-channel samples and trigger markers, groups EEG samples into display blocks, and emits `eeg://sample-block`.

`session.rs` owns recording lifecycle state, current session identity, user association, sample counts, timing, and status snapshots.

`storage.rs` owns binary file writing, metadata writing, and EEG session database persistence.

## Data Flow

Realtime EEG flow:

```text
EEG device TCP connection
  -> Rust TCP server
  -> EEG frame parser
  -> packet loss tracker and padding
  -> 32-channel sample stream
  -> block aggregator
  -> Tauri emit("eeg://sample-block")
  -> frontend ring buffer
```

Trigger flow:

```text
Trigger device TCP connection
  -> Rust TCP server
  -> trigger frame parser
  -> packet loss tracker and zero padding for recording
  -> latest trigger marker
  -> included in the next emitted EEG sample block when applicable
```

Recording flow:

```text
start_eeg_recording(user)
  -> create user-scoped session directory
  -> open binary EEG and trigger files
  -> write all 32 EEG channels and trigger samples while recording
  -> stop_eeg_recording()
  -> flush files
  -> write metadata.json
  -> insert eeg_sessions database row
```

## Tauri Event Contract

Rust keeps the existing event name:

```text
eeg://sample-block
```

Payload shape remains compatible with the existing frontend type:

```json
{
  "sequence": 12,
  "sampleRateHz": 1000,
  "startedAtMs": 1781265600000,
  "channelIds": ["ch01", "ch02", "ch03"],
  "samples": [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]],
  "triggerClass": null
}
```

Actual payloads contain 32 channel IDs and 32 sample arrays. The frontend controls which channels are visible.

## Frontend Display Behavior

Channel IDs and labels change from montage names to generic channel names:

- IDs: `ch01` through `ch32`
- Labels: `CH01` through `CH32`

The default visible set is `ch01` through `ch16`.

The channel picker allows selecting from all 32 channels, with at most 16 channels visible at the same time. The display limit is a UI constraint only. Rust always emits and records all 32 channels.

## Recording Format

Each recording session is stored under the logged-in user ID:

```text
<app-data>/tauri-eeg/eeg-recordings/
  <user_id>/
    session_YYYYMMDD_HHMMSS/
      eeg.f32le.bin
      trigger.i32le.bin
      metadata.json
```

EEG binary format:

- File: `eeg.f32le.bin`
- Type: little-endian `float32`
- Layout: `sample_major`
- Order:

```text
sample0_ch01, sample0_ch02, ... sample0_ch32,
sample1_ch01, sample1_ch02, ... sample1_ch32,
...
```

Trigger binary format:

- File: `trigger.i32le.bin`
- Type: little-endian `int32`
- One trigger value per sample.
- Missing trigger packets are padded with `0` during recording.

`metadata.json` includes enough information to read the files without application code:

```json
{
  "formatVersion": 1,
  "sessionId": "session_20260612_153000",
  "userId": "uuid",
  "username": "alice",
  "sampleRateHz": 1000,
  "channelCount": 32,
  "channelIds": ["ch01", "ch02", "ch03"],
  "displayChannelLimit": 16,
  "eegFile": "eeg.f32le.bin",
  "eegDtype": "float32_le",
  "eegLayout": "sample_major",
  "triggerFile": "trigger.i32le.bin",
  "triggerDtype": "int32_le",
  "sampleCount": 120000,
  "startedAt": "2026-06-12T15:30:00Z",
  "endedAt": "2026-06-12T15:32:00Z",
  "durationSeconds": 120.0
}
```

Python/NumPy can read the recording directly:

```python
import json
import numpy as np
from pathlib import Path

session = Path("session_20260612_153000")
meta = json.loads((session / "metadata.json").read_text(encoding="utf-8"))
eeg = np.fromfile(session / meta["eegFile"], dtype="<f4")
eeg = eeg.reshape(meta["sampleCount"], meta["channelCount"])
trigger = np.fromfile(session / meta["triggerFile"], dtype="<i4")
```

## User Binding

EEG recording is tied to the logged-in user. The acquisition service is global, but recording sessions are user-scoped.

The frontend passes the current authenticated user to recording commands:

```ts
startEegRecording({
  userId: currentUser.id,
  username: currentUser.username,
})
```

Rust validates that:

- `userId` is non-empty.
- `username` is non-empty.
- The user exists in SQLite before a recording session starts.

Session directories use `userId`, not `username`, because user IDs are stable. The username is still stored in metadata and database rows for readability.

## Database Schema

Add an `eeg_sessions` table:

```sql
CREATE TABLE IF NOT EXISTS eeg_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  session_dir TEXT NOT NULL,
  eeg_file TEXT NOT NULL,
  trigger_file TEXT NOT NULL,
  sample_rate_hz INTEGER NOT NULL,
  channel_count INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  duration_seconds REAL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

List and delete operations must filter by `user_id`:

```sql
WHERE user_id = ? AND id = ?
```

This matches the existing music history ownership model.

## Commands

The initial command set should be:

- `start_eeg_stream(config?) -> EegStreamInfo`
- `stop_eeg_stream() -> void`
- `get_eeg_status() -> EegStatus`
- `start_eeg_recording(input) -> EegRecordingSession`
- `stop_eeg_recording() -> EegRecordingSession`
- `list_eeg_sessions(userId) -> EegRecordingSession[]`

`start_eeg_stream` starts the TCP server and sends the UDP start command. Starting an already running stream is idempotent and returns current stream info.

`stop_eeg_stream` stops accepting new device connections and requests all device worker threads to exit. If recording is active, the command should stop recording first and flush metadata before returning.

`start_eeg_recording` fails if no EEG stream is running or if a recording is already active.

`stop_eeg_recording` fails if no recording is active.

## Error Handling

The Rust backend should expose operational errors through command results and status snapshots:

- TCP bind failure
- UDP start command failure
- EEG device disconnected
- Trigger device disconnected
- Unknown client connection
- Parser resynchronization after malformed bytes
- Recording start without a valid user
- File create/write/flush failure
- Database insert failure

Realtime acquisition should not panic on malformed frames or socket errors. Device worker threads should mark the relevant connection disconnected and exit cleanly.

Packet loss padding is bounded to avoid unbounded writes after a large packet index jump. Large reset-like gaps are treated as stream resets by the loss tracker.

## Testing

Unit tests:

- EEG frame parsing decodes known 24-bit samples to expected microvolt values.
- Trigger frame parsing extracts the trigger value.
- Parser skips junk bytes before a valid header.
- Packet loss tracker handles first packet, duplicates, missing packets, wrap-like values, and reset-like gaps.
- Metadata serialization contains all fields required for external reading.
- Database schema creates `eeg_sessions`.

Integration-style tests with local sockets:

- TCP server accepts an EEG client and emits sample blocks.
- Unknown client IP behavior is tested through the connection classifier where possible.
- Recording writes binary files with the expected byte count and metadata sample count.

Frontend tests:

- Default channels are `ch01` through `ch16`.
- Available channel list contains `ch01` through `ch32`.
- Visible channel selection is capped at 16.
- The ring buffer can ingest 32-channel payloads while displaying 16 selected channels.
