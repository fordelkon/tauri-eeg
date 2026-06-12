# Rust EEG Device Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simulated EEG backend with a Rust-owned TCP device server that emits 32-channel realtime blocks, records `.bin + metadata.json` sessions, and binds every recording to the logged-in user.

**Architecture:** Split `src-tauri/src/eeg.rs` into a focused `src-tauri/src/eeg/` module tree: protocol parsing, realtime block aggregation, recording session state, storage/database persistence, and TCP server runtime. Keep the existing Tauri event `eeg://sample-block`; the frontend receives 32 channels and limits display to 16 selected channels.

**Tech Stack:** Rust/Tauri, `std::net` TCP/UDP, `rusqlite`, `serde_json`, TypeScript, React, Vitest, Cargo tests.

---

## File Structure

- Delete: `src-tauri/src/eeg.rs`
- Create: `src-tauri/src/eeg/mod.rs`
  - Public Tauri-facing API, state container, command DTOs, lifecycle coordination.
- Create: `src-tauri/src/eeg/protocol.rs`
  - EEG/trigger frame parsing, 24-bit sample decode, packet-loss tracker.
- Create: `src-tauri/src/eeg/buffer.rs`
  - 32-channel block aggregation and `EegSampleBlockPayload` creation.
- Create: `src-tauri/src/eeg/session.rs`
  - Recording lifecycle models, current recording state, metadata DTOs.
- Create: `src-tauri/src/eeg/storage.rs`
  - User validation, session directory creation, binary writers, metadata writing, SQLite `eeg_sessions`.
- Create: `src-tauri/src/eeg/server.rs`
  - TCP listener, UDP start command, socket workers, shutdown.
- Modify: `src-tauri/src/lib.rs`
  - Add EEG commands and wire database/app handle into recording commands.
- Modify: `src-tauri/src/db.rs`
  - Initialize `eeg_sessions` schema.
- Modify: `src/eeg/channels.ts`
  - Export `ch01` through `ch32` and `DEFAULT_VISIBLE_EEG_CHANNEL_IDS`.
- Modify: `src/eeg/eegRingBuffer.test.ts`
  - Update channel IDs and add a 32-channel ingest test.
- Modify: `src/eeg/eegSessionState.ts`
  - Keep display limit behavior explicit if channel selection state lives here.
- Modify: `src/eeg/eegSessionState.test.ts`
  - Add max-16 visible selection coverage if reducer owns it.
- Modify: `src/eeg/EegSessionContext.tsx`
  - Use current user for recording commands and keep selected visible channel IDs.
- Modify: `src/eeg/eegApi.ts`
  - Add typed wrappers for recording/status/list commands.
- Modify: `src/eeg/EegChannelList.tsx`
  - Render selectable 32-channel list with max 16 visible.
- Modify: `src/eeg/EegWaveformPanel.tsx`
  - Read selected channel IDs from context without assuming 16 total channels.
- Modify: `src/eeg/types.ts`
  - Add EEG stream config/status/session DTOs.

## Assumptions

- Default stream config must match the fixed Flask deployment values from `D:\bciprogram\bci_flask_services\app.py`. These IPs are hardware/network configuration and must not be changed casually:

```rust
EegStreamConfig {
    bind_host: "192.168.1.101".to_string(),
    tcp_port: 5001,
    device_host: "192.168.1.102".to_string(),
    device_udp_port: 5001,
    eeg_device_ip: "192.168.1.102".to_string(),
    trigger_device_ip: "192.168.1.103".to_string(),
    sample_rate_hz: 1000,
    block_interval_ms: 50,
}
```

- Rust records all 32 channels even when the UI displays only 16.
- Recording start requires a valid `userId` and `username`; Rust verifies `users.id` exists before creating files.
- Trigger values are stored as one `i32` per EEG sample. If no trigger is active for a sample, write `0`.

---

### Task 1: Protocol Parser

**Files:**
- Create: `src-tauri/src/eeg/protocol.rs`
- Create: `src-tauri/src/eeg/mod.rs`
- Delete later: `src-tauri/src/eeg.rs`

- [ ] **Step 1: Create module shell**

Create `src-tauri/src/eeg/mod.rs`:

```rust
pub mod protocol;
```

- [ ] **Step 2: Write protocol tests**

Create `src-tauri/src/eeg/protocol.rs` with constants, empty type shells, and these tests:

```rust
pub const EEG_CHANNEL_COUNT: usize = 32;
pub const EEG_BYTES_PER_CHANNEL: usize = 3;
pub const EEG_DATA_LEN: usize = EEG_CHANNEL_COUNT * EEG_BYTES_PER_CHANNEL;
pub const EEG_START_BYTES: [u8; 2] = [0xA1, 0x05];
pub const TRIGGER_START_BYTES: [u8; 2] = [0xAA, 0x56];
pub const START_INSTRUCTION: [u8; 3] = [0xBB, 0x66, 0x01];
pub const FRAME_PREFIX_LEN: usize = 7;
pub const TRIGGER_DATA_LEN: usize = 3;
pub const SAMPLE_SCALE_UV: f32 = 0.02483;
pub const MAX_PADDED_PACKET_GAP: u32 = 256;

#[derive(Debug, Clone, PartialEq)]
pub enum ParsedFrame {
    Eeg {
        packet_index: u32,
        samples_uv: [f32; EEG_CHANNEL_COUNT],
    },
    Trigger {
        packet_index: u32,
        value: u8,
    },
}

pub struct ProtocolParser {
    buffer: Vec<u8>,
}

impl ProtocolParser {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    pub fn push_bytes(&mut self, _bytes: &[u8]) -> Vec<ParsedFrame> {
        Vec::new()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum PacketContinuity {
    First,
    Sequential,
    Duplicate,
    Missing(u32),
    Reset,
}

#[derive(Debug, Default)]
pub struct PacketLossTracker {
    last_packet_index: Option<u32>,
}

impl PacketLossTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn observe(&mut self, _packet_index: u32) -> PacketContinuity {
        PacketContinuity::First
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eeg_frame(packet_index: u32, raw_by_channel: &[[u8; 3]; EEG_CHANNEL_COUNT]) -> Vec<u8> {
        let mut frame = Vec::with_capacity(FRAME_PREFIX_LEN + EEG_DATA_LEN);
        frame.extend_from_slice(&EEG_START_BYTES);
        frame.push(0);
        frame.extend_from_slice(&packet_index.to_be_bytes());
        for raw in raw_by_channel {
            frame.extend_from_slice(raw);
        }
        frame
    }

    fn trigger_frame(packet_index: u32, value: u8) -> Vec<u8> {
        let mut frame = Vec::with_capacity(FRAME_PREFIX_LEN + TRIGGER_DATA_LEN);
        frame.extend_from_slice(&TRIGGER_START_BYTES);
        frame.push(value);
        frame.extend_from_slice(&packet_index.to_be_bytes());
        frame.extend_from_slice(&[0, 0, 0]);
        frame
    }

    #[test]
    fn parses_eeg_frame_and_decodes_24_bit_samples() {
        let mut raw = [[0x80, 0x00, 0x00]; EEG_CHANNEL_COUNT];
        raw[0] = [0x80, 0x00, 0x00];
        raw[1] = [0x80, 0x00, 0x01];
        raw[2] = [0x7F, 0xFF, 0xFF];

        let mut parser = ProtocolParser::new();
        let frames = parser.push_bytes(&eeg_frame(42, &raw));

        assert_eq!(frames.len(), 1);
        match &frames[0] {
            ParsedFrame::Eeg {
                packet_index,
                samples_uv,
            } => {
                assert_eq!(*packet_index, 42);
                assert!((samples_uv[0] - 0.0).abs() < 0.0001);
                assert!((samples_uv[1] - SAMPLE_SCALE_UV).abs() < 0.0001);
                assert!((samples_uv[2] + SAMPLE_SCALE_UV).abs() < 0.0001);
            }
            other => panic!("expected EEG frame, got {other:?}"),
        }
    }

    #[test]
    fn parses_trigger_frame_value_from_reserved_byte() {
        let mut parser = ProtocolParser::new();
        let frames = parser.push_bytes(&trigger_frame(7, 3));

        assert_eq!(frames, vec![ParsedFrame::Trigger { packet_index: 7, value: 3 }]);
    }

    #[test]
    fn skips_junk_before_valid_header() {
        let mut raw = [[0x80, 0x00, 0x00]; EEG_CHANNEL_COUNT];
        raw[0] = [0x80, 0x00, 0x01];
        let mut bytes = vec![0x00, 0x99, 0xA1, 0x00];
        bytes.extend_from_slice(&eeg_frame(2, &raw));

        let mut parser = ProtocolParser::new();
        let frames = parser.push_bytes(&bytes);

        assert_eq!(frames.len(), 1);
        assert!(matches!(frames[0], ParsedFrame::Eeg { packet_index: 2, .. }));
    }

    #[test]
    fn waits_for_complete_frame_across_chunks() {
        let raw = [[0x80, 0x00, 0x00]; EEG_CHANNEL_COUNT];
        let bytes = eeg_frame(9, &raw);
        let split_at = 12;
        let mut parser = ProtocolParser::new();

        assert!(parser.push_bytes(&bytes[..split_at]).is_empty());
        let frames = parser.push_bytes(&bytes[split_at..]);

        assert_eq!(frames.len(), 1);
        assert!(matches!(frames[0], ParsedFrame::Eeg { packet_index: 9, .. }));
    }

    #[test]
    fn tracks_first_sequential_duplicate_missing_and_reset_packets() {
        let mut tracker = PacketLossTracker::new();

        assert_eq!(tracker.observe(10), PacketContinuity::First);
        assert_eq!(tracker.observe(11), PacketContinuity::Sequential);
        assert_eq!(tracker.observe(11), PacketContinuity::Duplicate);
        assert_eq!(tracker.observe(14), PacketContinuity::Missing(2));
        assert_eq!(tracker.observe(10_000), PacketContinuity::Reset);
        assert_eq!(tracker.observe(10_001), PacketContinuity::Sequential);
    }
}
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
cd src-tauri
cargo test eeg::protocol --lib
```

Expected: at least the parser tests fail because `push_bytes` returns no frames and packet tracker always returns `First`.

- [ ] **Step 4: Implement parser and packet tracker**

Replace implementation sections in `src-tauri/src/eeg/protocol.rs`:

```rust
impl ProtocolParser {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    pub fn push_bytes(&mut self, bytes: &[u8]) -> Vec<ParsedFrame> {
        self.buffer.extend_from_slice(bytes);
        let mut frames = Vec::new();

        loop {
            let Some(header_index) = find_next_header(&self.buffer) else {
                keep_possible_partial_header(&mut self.buffer);
                break;
            };

            if header_index > 0 {
                self.buffer.drain(..header_index);
            }

            if self.buffer.len() < FRAME_PREFIX_LEN {
                break;
            }

            let is_eeg = self.buffer.starts_with(&EEG_START_BYTES);
            let frame_len = if is_eeg {
                FRAME_PREFIX_LEN + EEG_DATA_LEN
            } else {
                FRAME_PREFIX_LEN + TRIGGER_DATA_LEN
            };

            if self.buffer.len() < frame_len {
                break;
            }

            let reserved = self.buffer[2];
            let packet_index = u32::from_be_bytes([
                self.buffer[3],
                self.buffer[4],
                self.buffer[5],
                self.buffer[6],
            ]);
            let frame_bytes: Vec<u8> = self.buffer.drain(..frame_len).collect();

            if is_eeg {
                let mut samples_uv = [0.0_f32; EEG_CHANNEL_COUNT];
                let data = &frame_bytes[FRAME_PREFIX_LEN..];
                for (channel_index, chunk) in data.chunks_exact(EEG_BYTES_PER_CHANNEL).enumerate() {
                    samples_uv[channel_index] = decode_24_bit_sample_uv(chunk);
                }
                frames.push(ParsedFrame::Eeg {
                    packet_index,
                    samples_uv,
                });
            } else {
                frames.push(ParsedFrame::Trigger {
                    packet_index,
                    value: reserved,
                });
            }
        }

        frames
    }
}

fn find_next_header(bytes: &[u8]) -> Option<usize> {
    bytes
        .windows(2)
        .position(|window| window == EEG_START_BYTES || window == TRIGGER_START_BYTES)
}

fn keep_possible_partial_header(buffer: &mut Vec<u8>) {
    let keep_last = buffer
        .last()
        .copied()
        .filter(|byte| *byte == EEG_START_BYTES[0] || *byte == TRIGGER_START_BYTES[0]);
    buffer.clear();
    if let Some(byte) = keep_last {
        buffer.push(byte);
    }
}

fn decode_24_bit_sample_uv(bytes: &[u8]) -> f32 {
    let converted = [bytes[0] ^ 0x80, bytes[1], bytes[2]];
    let unsigned = u32::from_be_bytes([0, converted[0], converted[1], converted[2]]);
    (unsigned as i32 - 8_388_608) as f32 * SAMPLE_SCALE_UV
}

impl PacketLossTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn observe(&mut self, packet_index: u32) -> PacketContinuity {
        let Some(last) = self.last_packet_index else {
            self.last_packet_index = Some(packet_index);
            return PacketContinuity::First;
        };

        if packet_index == last {
            return PacketContinuity::Duplicate;
        }

        if packet_index == last.wrapping_add(1) {
            self.last_packet_index = Some(packet_index);
            return PacketContinuity::Sequential;
        }

        if packet_index > last {
            let gap = packet_index - last - 1;
            self.last_packet_index = Some(packet_index);
            if gap <= MAX_PADDED_PACKET_GAP {
                PacketContinuity::Missing(gap)
            } else {
                PacketContinuity::Reset
            }
        } else {
            self.last_packet_index = Some(packet_index);
            PacketContinuity::Reset
        }
    }
}
```

- [ ] **Step 5: Run protocol tests**

Run:

```bash
cd src-tauri
cargo test eeg::protocol --lib
```

Expected: all `eeg::protocol` tests pass.

- [ ] **Step 6: Commit Task 1**

```bash
git add src-tauri/src/eeg/mod.rs src-tauri/src/eeg/protocol.rs
git commit -m "feat(eeg): add device protocol parser"
```

---

### Task 2: Realtime Block Aggregator

**Files:**
- Create: `src-tauri/src/eeg/buffer.rs`
- Modify: `src-tauri/src/eeg/mod.rs`

- [ ] **Step 1: Export buffer module**

Modify `src-tauri/src/eeg/mod.rs`:

```rust
pub mod buffer;
pub mod protocol;
```

- [ ] **Step 2: Write aggregator tests**

Create `src-tauri/src/eeg/buffer.rs`:

```rust
use serde::Serialize;

use super::protocol::EEG_CHANNEL_COUNT;

pub const EEG_SAMPLE_BLOCK_EVENT: &str = "eeg://sample-block";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EegSampleBlockPayload {
    pub sequence: u64,
    pub sample_rate_hz: u32,
    pub started_at_ms: i64,
    pub channel_ids: Vec<String>,
    pub samples: Vec<Vec<f32>>,
    pub trigger_class: Option<u8>,
}

pub fn default_channel_ids() -> Vec<String> {
    (1..=EEG_CHANNEL_COUNT)
        .map(|index| format!("ch{index:02}"))
        .collect()
}

pub struct RealtimeBlockAggregator {
    sample_rate_hz: u32,
    block_interval_ms: u64,
    sequence: u64,
    started_at_ms: Option<i64>,
    pending_samples: Vec<[f32; EEG_CHANNEL_COUNT]>,
    pending_trigger: Option<u8>,
}

impl RealtimeBlockAggregator {
    pub fn new(sample_rate_hz: u32, block_interval_ms: u64) -> Result<Self, String> {
        if sample_rate_hz == 0 {
            return Err("EEG sample rate must be positive.".to_string());
        }
        if block_interval_ms == 0 {
            return Err("EEG block interval must be positive.".to_string());
        }
        Ok(Self {
            sample_rate_hz,
            block_interval_ms,
            sequence: 0,
            started_at_ms: None,
            pending_samples: Vec::new(),
            pending_trigger: None,
        })
    }

    pub fn push_sample(
        &mut self,
        _sample: [f32; EEG_CHANNEL_COUNT],
        _trigger: Option<u8>,
        _sample_time_ms: i64,
    ) -> Option<EegSampleBlockPayload> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(value: f32) -> [f32; EEG_CHANNEL_COUNT] {
        [value; EEG_CHANNEL_COUNT]
    }

    #[test]
    fn default_channel_ids_are_ch01_to_ch32() {
        let ids = default_channel_ids();

        assert_eq!(ids.len(), 32);
        assert_eq!(ids[0], "ch01");
        assert_eq!(ids[15], "ch16");
        assert_eq!(ids[31], "ch32");
    }

    #[test]
    fn emits_block_after_configured_sample_count() {
        let mut aggregator = RealtimeBlockAggregator::new(1000, 50).expect("aggregator");
        let mut block = None;

        for index in 0..49 {
            assert!(aggregator.push_sample(sample(index as f32), None, 1_000 + index).is_none());
        }
        block = aggregator.push_sample(sample(49.0), Some(2), 1_049);

        let block = block.expect("block emitted");
        assert_eq!(block.sequence, 0);
        assert_eq!(block.sample_rate_hz, 1000);
        assert_eq!(block.started_at_ms, 1_000);
        assert_eq!(block.channel_ids.len(), 32);
        assert_eq!(block.samples.len(), 32);
        assert_eq!(block.samples[0].len(), 50);
        assert_eq!(block.samples[0][0], 0.0);
        assert_eq!(block.samples[0][49], 49.0);
        assert_eq!(block.trigger_class, Some(2));
    }

    #[test]
    fn increments_sequence_and_clears_trigger_after_emit() {
        let mut aggregator = RealtimeBlockAggregator::new(2, 500).expect("aggregator");

        let first = aggregator.push_sample(sample(1.0), Some(5), 10).expect("first");
        let second = aggregator.push_sample(sample(2.0), None, 510).expect("second");

        assert_eq!(first.sequence, 0);
        assert_eq!(first.trigger_class, Some(5));
        assert_eq!(second.sequence, 1);
        assert_eq!(second.trigger_class, None);
        assert_eq!(second.started_at_ms, 510);
    }
}
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
cd src-tauri
cargo test eeg::buffer --lib
```

Expected: aggregator emit tests fail because `push_sample` returns `None`.

- [ ] **Step 4: Implement aggregator**

Replace `push_sample` and add helper:

```rust
    pub fn push_sample(
        &mut self,
        sample: [f32; EEG_CHANNEL_COUNT],
        trigger: Option<u8>,
        sample_time_ms: i64,
    ) -> Option<EegSampleBlockPayload> {
        if self.started_at_ms.is_none() {
            self.started_at_ms = Some(sample_time_ms);
        }
        if let Some(trigger) = trigger.filter(|value| *value != 0) {
            self.pending_trigger = Some(trigger);
        }

        self.pending_samples.push(sample);

        if self.pending_samples.len() < self.samples_per_block() {
            return None;
        }

        let mut samples = vec![Vec::with_capacity(self.pending_samples.len()); EEG_CHANNEL_COUNT];
        for sample in self.pending_samples.drain(..) {
            for channel_index in 0..EEG_CHANNEL_COUNT {
                samples[channel_index].push(sample[channel_index]);
            }
        }

        let payload = EegSampleBlockPayload {
            sequence: self.sequence,
            sample_rate_hz: self.sample_rate_hz,
            started_at_ms: self.started_at_ms.take().unwrap_or(sample_time_ms),
            channel_ids: default_channel_ids(),
            samples,
            trigger_class: self.pending_trigger.take(),
        };
        self.sequence += 1;
        Some(payload)
    }

    fn samples_per_block(&self) -> usize {
        ((self.sample_rate_hz as u64 * self.block_interval_ms) / 1_000).max(1) as usize
    }
```

- [ ] **Step 5: Run buffer tests**

Run:

```bash
cd src-tauri
cargo test eeg::buffer --lib
```

Expected: all `eeg::buffer` tests pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add src-tauri/src/eeg/mod.rs src-tauri/src/eeg/buffer.rs
git commit -m "feat(eeg): aggregate realtime sample blocks"
```

---

### Task 3: Recording Session and Storage

**Files:**
- Create: `src-tauri/src/eeg/session.rs`
- Create: `src-tauri/src/eeg/storage.rs`
- Modify: `src-tauri/src/eeg/mod.rs`
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Export session and storage modules**

Modify `src-tauri/src/eeg/mod.rs`:

```rust
pub mod buffer;
pub mod protocol;
pub mod session;
pub mod storage;
```

- [ ] **Step 2: Add database schema hook**

Modify `src-tauri/src/db.rs` inside `init_schema` after music history initialization:

```rust
    crate::music_history::init_music_history_schema(conn)?;
    crate::eeg::storage::init_eeg_session_schema(conn)?;
```

Add test:

```rust
    #[test]
    fn creates_eeg_sessions_table() {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");

        init_schema(&conn).expect("init schema");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'eeg_sessions'",
                [],
                |row| row.get(0),
            )
            .expect("query sqlite schema");

        assert_eq!(count, 1);
    }
```

- [ ] **Step 3: Write storage/session tests**

Create `src-tauri/src/eeg/session.rs`:

```rust
use serde::{Deserialize, Serialize};

use super::protocol::EEG_CHANNEL_COUNT;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartEegRecordingInput {
    pub user_id: String,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EegRecordingSession {
    pub id: String,
    pub user_id: String,
    pub username: String,
    pub session_dir: String,
    pub eeg_file: String,
    pub trigger_file: String,
    pub metadata_file: String,
    pub sample_rate_hz: u32,
    pub channel_count: usize,
    pub sample_count: u64,
    pub duration_seconds: Option<f64>,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EegRecordingMetadata {
    pub format_version: u32,
    pub session_id: String,
    pub user_id: String,
    pub username: String,
    pub sample_rate_hz: u32,
    pub channel_count: usize,
    pub channel_ids: Vec<String>,
    pub display_channel_limit: usize,
    pub eeg_file: String,
    pub eeg_dtype: String,
    pub eeg_layout: String,
    pub trigger_file: String,
    pub trigger_dtype: String,
    pub sample_count: u64,
    pub started_at: String,
    pub ended_at: String,
    pub duration_seconds: f64,
}

pub const EEG_FILE_NAME: &str = "eeg.f32le.bin";
pub const TRIGGER_FILE_NAME: &str = "trigger.i32le.bin";
pub const METADATA_FILE_NAME: &str = "metadata.json";
pub const DISPLAY_CHANNEL_LIMIT: usize = 16;

pub fn channel_count() -> usize {
    EEG_CHANNEL_COUNT
}
```

Create `src-tauri/src/eeg/storage.rs`:

```rust
use std::{
    fs::{self, File},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};

use super::{
    buffer::default_channel_ids,
    protocol::EEG_CHANNEL_COUNT,
    session::{
        EegRecordingMetadata, EegRecordingSession, METADATA_FILE_NAME, EEG_FILE_NAME,
        TRIGGER_FILE_NAME, DISPLAY_CHANNEL_LIMIT,
    },
};

pub struct RecordingWriter {
    session: EegRecordingSession,
    eeg_writer: BufWriter<File>,
    trigger_writer: BufWriter<File>,
    sample_count: u64,
    started_at_utc: DateTime<Utc>,
}

pub fn init_eeg_session_schema(_conn: &Connection) -> Result<(), String> {
    Ok(())
}

pub fn validate_user_exists(_conn: &Connection, _user_id: &str) -> Result<(), String> {
    Ok(())
}

pub fn create_recording_writer(
    _base_dir: &Path,
    _user_id: &str,
    _username: &str,
    _sample_rate_hz: u32,
) -> Result<RecordingWriter, String> {
    Err("Recording writer creation is not wired yet.".to_string())
}

impl RecordingWriter {
    pub fn write_sample(
        &mut self,
        _samples_uv: &[f32; EEG_CHANNEL_COUNT],
        _trigger: i32,
    ) -> Result<(), String> {
        Ok(())
    }

    pub fn finish(self, _conn: &Connection) -> Result<EegRecordingSession, String> {
        Ok(self.session)
    }
}

pub fn list_eeg_sessions(
    _conn: &Connection,
    _user_id: &str,
) -> Result<Vec<EegRecordingSession>, String> {
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::fs;

    fn create_user(conn: &Connection, user_id: &str) {
        conn.execute(
            "CREATE TABLE users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )
        .expect("create users");
        conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at, updated_at)
             VALUES (?1, 'alice', 'hash', '2026-06-12T00:00:00Z', '2026-06-12T00:00:00Z')",
            [user_id],
        )
        .expect("insert user");
    }

    #[test]
    fn creates_eeg_session_schema() {
        let conn = Connection::open_in_memory().expect("open sqlite");

        init_eeg_session_schema(&conn).expect("init schema");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'eeg_sessions'",
                [],
                |row| row.get(0),
            )
            .expect("query schema");
        assert_eq!(count, 1);
    }

    #[test]
    fn validates_user_existence() {
        let conn = Connection::open_in_memory().expect("open sqlite");
        create_user(&conn, "user-1");

        assert!(validate_user_exists(&conn, "user-1").is_ok());
        assert_eq!(
            validate_user_exists(&conn, "missing").unwrap_err(),
            "Recording user does not exist."
        );
    }

    #[test]
    fn writes_binary_files_metadata_and_database_row() {
        let temp = std::env::temp_dir().join(format!("tauri-eeg-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp).expect("create temp");
        let conn = Connection::open_in_memory().expect("open sqlite");
        create_user(&conn, "user-1");
        init_eeg_session_schema(&conn).expect("init schema");

        let mut writer = create_recording_writer(&temp, "user-1", "alice", 1000).expect("writer");
        writer.write_sample(&[1.5; EEG_CHANNEL_COUNT], 7).expect("write sample");
        writer.write_sample(&[2.5; EEG_CHANNEL_COUNT], 0).expect("write sample");
        let session = writer.finish(&conn).expect("finish");

        let session_dir = PathBuf::from(&session.session_dir);
        assert_eq!(fs::metadata(session_dir.join(EEG_FILE_NAME)).expect("eeg metadata").len(), 2 * 32 * 4);
        assert_eq!(fs::metadata(session_dir.join(TRIGGER_FILE_NAME)).expect("trigger metadata").len(), 2 * 4);
        let metadata_text = fs::read_to_string(session_dir.join(METADATA_FILE_NAME)).expect("metadata text");
        let metadata: EegRecordingMetadata = serde_json::from_str(&metadata_text).expect("metadata json");
        assert_eq!(metadata.user_id, "user-1");
        assert_eq!(metadata.username, "alice");
        assert_eq!(metadata.sample_count, 2);
        assert_eq!(metadata.channel_count, 32);
        assert_eq!(metadata.channel_ids[0], "ch01");
        assert_eq!(metadata.eeg_dtype, "float32_le");
        assert_eq!(metadata.eeg_layout, "sample_major");
        assert_eq!(metadata.trigger_dtype, "int32_le");

        let sessions = list_eeg_sessions(&conn, "user-1").expect("list sessions");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, session.id);

        fs::remove_dir_all(temp).expect("cleanup temp");
    }
}
```

- [ ] **Step 4: Run tests and verify failure**

Run:

```bash
cd src-tauri
cargo test eeg::storage db::tests::creates_eeg_sessions_table --lib
```

Expected: schema and writer tests fail until storage is implemented.

- [ ] **Step 5: Implement schema, writer, metadata, and listing**

Replace `storage.rs` implementation:

```rust
pub fn init_eeg_session_schema(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS eeg_sessions (
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
        )",
        [],
    )
    .map_err(|_| "Failed to initialize EEG session schema.".to_string())?;
    Ok(())
}

pub fn validate_user_exists(conn: &Connection, user_id: &str) -> Result<(), String> {
    if user_id.trim().is_empty() {
        return Err("Recording user ID is required.".to_string());
    }

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM users WHERE id = ?1",
            [user_id],
            |row| row.get(0),
        )
        .map_err(|_| "Failed to validate recording user.".to_string())?;

    if count == 0 {
        return Err("Recording user does not exist.".to_string());
    }

    Ok(())
}

pub fn create_recording_writer(
    base_dir: &Path,
    user_id: &str,
    username: &str,
    sample_rate_hz: u32,
) -> Result<RecordingWriter, String> {
    if user_id.trim().is_empty() {
        return Err("Recording user ID is required.".to_string());
    }
    if username.trim().is_empty() {
        return Err("Recording username is required.".to_string());
    }

    let started_at_utc = Utc::now();
    let id = format!("session_{}", started_at_utc.format("%Y%m%d_%H%M%S"));
    let session_dir = base_dir.join(user_id).join(&id);
    fs::create_dir_all(&session_dir)
        .map_err(|_| "Failed to create EEG recording directory.".to_string())?;

    let eeg_path = session_dir.join(EEG_FILE_NAME);
    let trigger_path = session_dir.join(TRIGGER_FILE_NAME);
    let eeg_writer = BufWriter::new(
        File::create(&eeg_path).map_err(|_| "Failed to create EEG binary file.".to_string())?,
    );
    let trigger_writer = BufWriter::new(
        File::create(&trigger_path)
            .map_err(|_| "Failed to create EEG trigger binary file.".to_string())?,
    );

    let started_at = started_at_utc.to_rfc3339();
    Ok(RecordingWriter {
        session: EegRecordingSession {
            id,
            user_id: user_id.to_string(),
            username: username.to_string(),
            session_dir: session_dir.to_string_lossy().to_string(),
            eeg_file: EEG_FILE_NAME.to_string(),
            trigger_file: TRIGGER_FILE_NAME.to_string(),
            metadata_file: METADATA_FILE_NAME.to_string(),
            sample_rate_hz,
            channel_count: EEG_CHANNEL_COUNT,
            sample_count: 0,
            duration_seconds: None,
            started_at,
            ended_at: None,
        },
        eeg_writer,
        trigger_writer,
        sample_count: 0,
        started_at_utc,
    })
}

impl RecordingWriter {
    pub fn write_sample(
        &mut self,
        samples_uv: &[f32; EEG_CHANNEL_COUNT],
        trigger: i32,
    ) -> Result<(), String> {
        for sample in samples_uv {
            self.eeg_writer
                .write_all(&sample.to_le_bytes())
                .map_err(|_| "Failed to write EEG sample.".to_string())?;
        }
        self.trigger_writer
            .write_all(&trigger.to_le_bytes())
            .map_err(|_| "Failed to write EEG trigger sample.".to_string())?;
        self.sample_count += 1;
        Ok(())
    }

    pub fn finish(mut self, conn: &Connection) -> Result<EegRecordingSession, String> {
        self.eeg_writer
            .flush()
            .map_err(|_| "Failed to flush EEG binary file.".to_string())?;
        self.trigger_writer
            .flush()
            .map_err(|_| "Failed to flush EEG trigger binary file.".to_string())?;

        let ended_at_utc = Utc::now();
        let duration_seconds = (ended_at_utc - self.started_at_utc)
            .num_milliseconds()
            .max(0) as f64
            / 1000.0;
        self.session.sample_count = self.sample_count;
        self.session.ended_at = Some(ended_at_utc.to_rfc3339());
        self.session.duration_seconds = Some(duration_seconds);

        let metadata = EegRecordingMetadata {
            format_version: 1,
            session_id: self.session.id.clone(),
            user_id: self.session.user_id.clone(),
            username: self.session.username.clone(),
            sample_rate_hz: self.session.sample_rate_hz,
            channel_count: EEG_CHANNEL_COUNT,
            channel_ids: default_channel_ids(),
            display_channel_limit: DISPLAY_CHANNEL_LIMIT,
            eeg_file: EEG_FILE_NAME.to_string(),
            eeg_dtype: "float32_le".to_string(),
            eeg_layout: "sample_major".to_string(),
            trigger_file: TRIGGER_FILE_NAME.to_string(),
            trigger_dtype: "int32_le".to_string(),
            sample_count: self.sample_count,
            started_at: self.session.started_at.clone(),
            ended_at: self.session.ended_at.clone().unwrap_or_default(),
            duration_seconds,
        };

        let metadata_path = PathBuf::from(&self.session.session_dir).join(METADATA_FILE_NAME);
        let metadata_text = serde_json::to_string_pretty(&metadata)
            .map_err(|_| "Failed to serialize EEG metadata.".to_string())?;
        fs::write(metadata_path, metadata_text)
            .map_err(|_| "Failed to write EEG metadata.".to_string())?;

        conn.execute(
            "INSERT INTO eeg_sessions (
                id, user_id, username, session_dir, eeg_file, trigger_file, sample_rate_hz,
                channel_count, sample_count, duration_seconds, started_at, ended_at, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                self.session.id,
                self.session.user_id,
                self.session.username,
                self.session.session_dir,
                self.session.eeg_file,
                self.session.trigger_file,
                self.session.sample_rate_hz as i64,
                self.session.channel_count as i64,
                self.session.sample_count as i64,
                self.session.duration_seconds,
                self.session.started_at,
                self.session.ended_at,
                Utc::now().to_rfc3339(),
            ],
        )
        .map_err(|_| "Failed to save EEG recording session.".to_string())?;

        Ok(self.session)
    }
}

pub fn list_eeg_sessions(
    conn: &Connection,
    user_id: &str,
) -> Result<Vec<EegRecordingSession>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, username, session_dir, eeg_file, trigger_file, sample_rate_hz,
                    channel_count, sample_count, duration_seconds, started_at, ended_at
             FROM eeg_sessions
             WHERE user_id = ?1
             ORDER BY started_at DESC",
        )
        .map_err(|_| "Failed to list EEG recording sessions.".to_string())?;

    let rows = stmt
        .query_map([user_id], |row| {
            Ok(EegRecordingSession {
                id: row.get(0)?,
                user_id: row.get(1)?,
                username: row.get(2)?,
                session_dir: row.get(3)?,
                eeg_file: row.get(4)?,
                trigger_file: row.get(5)?,
                metadata_file: METADATA_FILE_NAME.to_string(),
                sample_rate_hz: row.get::<_, i64>(6)? as u32,
                channel_count: row.get::<_, i64>(7)? as usize,
                sample_count: row.get::<_, i64>(8)? as u64,
                duration_seconds: row.get(9)?,
                started_at: row.get(10)?,
                ended_at: row.get(11)?,
            })
        })
        .map_err(|_| "Failed to list EEG recording sessions.".to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Failed to read EEG recording sessions.".to_string())
}
```

Add derives to `EegRecordingMetadata` in `session.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
```

- [ ] **Step 6: Run storage and schema tests**

Run:

```bash
cd src-tauri
cargo test eeg::storage db::tests::creates_eeg_sessions_table --lib
```

Expected: storage and schema tests pass.

- [ ] **Step 7: Commit Task 3**

```bash
git add src-tauri/src/eeg/mod.rs src-tauri/src/eeg/session.rs src-tauri/src/eeg/storage.rs src-tauri/src/db.rs
git commit -m "feat(eeg): persist user-bound recordings"
```

---

### Task 4: EEG Runtime State and Tauri Commands

**Files:**
- Modify: `src-tauri/src/eeg/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write state tests in `mod.rs`**

Replace `src-tauri/src/eeg/mod.rs` with module exports plus state shells and tests:

```rust
pub mod buffer;
pub mod protocol;
pub mod session;
pub mod storage;

use std::{
    path::Path,
    sync::{Arc, Mutex},
};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use self::{
    session::{EegRecordingSession, StartEegRecordingInput},
    storage::RecordingWriter,
};

pub const DEFAULT_SAMPLE_RATE_HZ: u32 = 1000;
pub const DEFAULT_BLOCK_INTERVAL_MS: u64 = 50;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EegStreamConfig {
    pub bind_host: String,
    pub tcp_port: u16,
    pub device_host: String,
    pub device_udp_port: u16,
    pub eeg_device_ip: String,
    pub trigger_device_ip: String,
    pub sample_rate_hz: u32,
    pub block_interval_ms: u64,
}

impl Default for EegStreamConfig {
    fn default() -> Self {
        Self {
            bind_host: "192.168.1.101".to_string(),
            tcp_port: 5001,
            device_host: "192.168.1.102".to_string(),
            device_udp_port: 5001,
            eeg_device_ip: "192.168.1.102".to_string(),
            trigger_device_ip: "192.168.1.103".to_string(),
            sample_rate_hz: DEFAULT_SAMPLE_RATE_HZ,
            block_interval_ms: DEFAULT_BLOCK_INTERVAL_MS,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EegStreamInfo {
    pub sample_rate_hz: u32,
    pub block_interval_ms: u64,
    pub channel_ids: Vec<String>,
    pub tcp_port: u16,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EegStatus {
    pub is_streaming: bool,
    pub is_recording: bool,
    pub sample_rate_hz: u32,
    pub block_interval_ms: u64,
    pub channel_ids: Vec<String>,
    pub active_recording: Option<EegRecordingSession>,
}

#[derive(Default)]
pub struct EegStreamState {
    inner: Mutex<EegRuntime>,
}

#[derive(Default)]
struct EegRuntime {
    config: Option<EegStreamConfig>,
    recording: Option<RecordingWriter>,
    last_recording: Option<EegRecordingSession>,
}

pub fn default_stream_info() -> EegStreamInfo {
    stream_info_from_config(&EegStreamConfig::default())
}

pub fn stream_info_from_config(config: &EegStreamConfig) -> EegStreamInfo {
    EegStreamInfo {
        sample_rate_hz: config.sample_rate_hz,
        block_interval_ms: config.block_interval_ms,
        channel_ids: buffer::default_channel_ids(),
        tcp_port: config.tcp_port,
    }
}

pub fn get_status(state: &EegStreamState) -> Result<EegStatus, String> {
    let runtime = state
        .inner
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())?;
    let config = runtime.config.clone().unwrap_or_default();
    Ok(EegStatus {
        is_streaming: runtime.config.is_some(),
        is_recording: runtime.recording.is_some(),
        sample_rate_hz: config.sample_rate_hz,
        block_interval_ms: config.block_interval_ms,
        channel_ids: buffer::default_channel_ids(),
        active_recording: runtime.last_recording.clone(),
    })
}

pub fn start_recording(
    _state: &EegStreamState,
    _conn: &Connection,
    _base_dir: &Path,
    _input: StartEegRecordingInput,
) -> Result<EegRecordingSession, String> {
    Err("Start the EEG stream before recording.".to_string())
}

pub fn stop_recording(
    _state: &EegStreamState,
    _conn: &Connection,
) -> Result<EegRecordingSession, String> {
    Err("No EEG recording is active.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::fs;

    fn create_conn_with_user() -> Connection {
        let conn = Connection::open_in_memory().expect("open sqlite");
        conn.execute(
            "CREATE TABLE users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )
        .expect("create users");
        conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at, updated_at)
             VALUES ('user-1', 'alice', 'hash', '2026-06-12T00:00:00Z', '2026-06-12T00:00:00Z')",
            [],
        )
        .expect("insert user");
        storage::init_eeg_session_schema(&conn).expect("init eeg schema");
        conn
    }

    #[test]
    fn default_stream_info_uses_32_channels() {
        let info = default_stream_info();

        assert_eq!(info.sample_rate_hz, 1000);
        assert_eq!(info.block_interval_ms, 50);
        assert_eq!(info.channel_ids.len(), 32);
        assert_eq!(info.channel_ids[0], "ch01");
        assert_eq!(info.channel_ids[31], "ch32");
    }

    #[test]
    fn rejects_recording_without_streaming() {
        let state = EegStreamState::default();
        let conn = create_conn_with_user();
        let temp = std::env::temp_dir().join(format!("tauri-eeg-state-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp).expect("temp dir");

        let err = start_recording(
            &state,
            &conn,
            &temp,
            StartEegRecordingInput {
                user_id: "user-1".to_string(),
                username: "alice".to_string(),
            },
        )
        .unwrap_err();

        assert_eq!(err, "Start the EEG stream before recording.");
        fs::remove_dir_all(temp).expect("cleanup");
    }

    #[test]
    fn starts_and_stops_recording_for_valid_user() {
        let state = EegStreamState::default();
        {
            let mut runtime = state.inner.lock().expect("lock runtime");
            runtime.config = Some(EegStreamConfig::default());
        }
        let conn = create_conn_with_user();
        let temp = std::env::temp_dir().join(format!("tauri-eeg-state-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp).expect("temp dir");

        let session = start_recording(
            &state,
            &conn,
            &temp,
            StartEegRecordingInput {
                user_id: "user-1".to_string(),
                username: "alice".to_string(),
            },
        )
        .expect("start recording");
        assert_eq!(session.user_id, "user-1");

        let stopped = stop_recording(&state, &conn).expect("stop recording");
        assert_eq!(stopped.id, session.id);

        fs::remove_dir_all(temp).expect("cleanup");
    }
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd src-tauri
cargo test eeg::tests --lib
```

Expected: recording tests fail because recording lifecycle functions still return fixed error values.

- [ ] **Step 3: Implement recording lifecycle**

Replace `start_recording` and `stop_recording`:

```rust
pub fn start_recording(
    state: &EegStreamState,
    conn: &Connection,
    base_dir: &Path,
    input: StartEegRecordingInput,
) -> Result<EegRecordingSession, String> {
    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())?;
    let config = runtime
        .config
        .clone()
        .ok_or_else(|| "Start the EEG stream before recording.".to_string())?;

    if runtime.recording.is_some() {
        return Err("EEG recording is already active.".to_string());
    }

    storage::validate_user_exists(conn, &input.user_id)?;
    let writer = storage::create_recording_writer(
        base_dir,
        &input.user_id,
        &input.username,
        config.sample_rate_hz,
    )?;
    let session = writer.session().clone();
    runtime.last_recording = Some(session.clone());
    runtime.recording = Some(writer);
    Ok(session)
}

pub fn stop_recording(
    state: &EegStreamState,
    conn: &Connection,
) -> Result<EegRecordingSession, String> {
    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())?;
    let writer = runtime
        .recording
        .take()
        .ok_or_else(|| "No EEG recording is active.".to_string())?;
    let session = writer.finish(conn)?;
    runtime.last_recording = Some(session.clone());
    Ok(session)
}
```

Add method to `RecordingWriter` in `storage.rs`:

```rust
    pub fn session(&self) -> &EegRecordingSession {
        &self.session
    }
```

- [ ] **Step 4: Add Tauri command wrappers**

Modify `src-tauri/src/lib.rs` imports:

```rust
use eeg::{
    EegRecordingSession, EegStatus, EegStreamConfig, EegStreamInfo, EegStreamState,
    StartEegRecordingInput,
};
```

Add commands:

```rust
#[tauri::command]
fn get_eeg_status(state: State<'_, EegStreamState>) -> Result<EegStatus, String> {
    eeg::get_status(&state)
}

#[tauri::command]
fn start_eeg_recording(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    state: State<'_, EegStreamState>,
    input: StartEegRecordingInput,
) -> Result<EegRecordingSession, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Failed to resolve app data directory.".to_string())?
        .join("eeg-recordings");
    std::fs::create_dir_all(&base_dir)
        .map_err(|_| "Failed to create EEG recording directory.".to_string())?;
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;
    eeg::start_recording(&state, &conn, &base_dir, input)
}

#[tauri::command]
fn stop_eeg_recording(
    db: State<'_, AppDb>,
    state: State<'_, EegStreamState>,
) -> Result<EegRecordingSession, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;
    eeg::stop_recording(&state, &conn)
}

#[tauri::command]
fn list_eeg_sessions(
    db: State<'_, AppDb>,
    user_id: String,
) -> Result<Vec<EegRecordingSession>, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;
    eeg::storage::list_eeg_sessions(&conn, &user_id)
}
```

Update `invoke_handler`:

```rust
            get_eeg_status,
            start_eeg_recording,
            stop_eeg_recording,
            list_eeg_sessions,
```

- [ ] **Step 5: Run Rust tests**

Run:

```bash
cd src-tauri
cargo test --lib
```

Expected: all Rust library tests pass before TCP server integration starts.

- [ ] **Step 6: Commit Task 4**

```bash
git add src-tauri/src/eeg/mod.rs src-tauri/src/eeg/storage.rs src-tauri/src/lib.rs
git commit -m "feat(eeg): expose recording commands"
```

---

### Task 5: TCP Server Runtime

**Files:**
- Create: `src-tauri/src/eeg/server.rs`
- Modify: `src-tauri/src/eeg/mod.rs`

- [ ] **Step 1: Export server module and add runtime worker field**

Modify `src-tauri/src/eeg/mod.rs`:

```rust
pub mod server;
```

Add field to `EegRuntime`:

```rust
    worker: Option<server::EegServerWorker>,
```

- [ ] **Step 2: Create server tests for config validation**

Create `src-tauri/src/eeg/server.rs`:

```rust
use std::{
    net::UdpSocket,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::JoinHandle,
};

use tauri::AppHandle;

use super::{protocol::START_INSTRUCTION, EegStreamConfig};

pub struct EegServerWorker {
    stop_requested: Arc<AtomicBool>,
    join_handle: Option<JoinHandle<()>>,
}

impl EegServerWorker {
    pub fn stop(mut self) {
        self.stop_requested.store(true, Ordering::Relaxed);
        if let Some(join_handle) = self.join_handle.take() {
            let _ = join_handle.join();
        }
    }
}

pub fn send_start_instruction(config: &EegStreamConfig) -> Result<(), String> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|_| "Failed to bind EEG start UDP socket.".to_string())?;
    socket
        .send_to(
            &START_INSTRUCTION,
            format!("{}:{}", config.device_host, config.device_udp_port),
        )
        .map_err(|_| "Failed to send EEG start instruction.".to_string())?;
    Ok(())
}

pub fn start_server(_app: AppHandle, _config: EegStreamConfig) -> Result<EegServerWorker, String> {
    Err("EEG TCP server is not wired yet.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_instruction_bytes_match_device_protocol() {
        assert_eq!(START_INSTRUCTION, [0xBB, 0x66, 0x01]);
    }
}
```

- [ ] **Step 3: Add stream lifecycle functions in `mod.rs`**

Add functions:

```rust
pub fn start_stream(
    app: tauri::AppHandle,
    state: &EegStreamState,
    config: Option<EegStreamConfig>,
) -> Result<EegStreamInfo, String> {
    let config = config.unwrap_or_default();
    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())?;

    if runtime.worker.is_some() {
        return Ok(stream_info_from_config(runtime.config.as_ref().unwrap_or(&config)));
    }

    server::send_start_instruction(&config)?;
    let worker = server::start_server(app, config.clone())?;
    runtime.config = Some(config.clone());
    runtime.worker = Some(worker);
    Ok(stream_info_from_config(&config))
}

pub fn stop_stream(state: &EegStreamState, conn: Option<&Connection>) -> Result<(), String> {
    let recording = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "EEG stream state is unavailable.".to_string())?;
        runtime.recording.take()
    };

    if let Some(writer) = recording {
        let conn = conn.ok_or_else(|| "Database is required to stop active EEG recording.".to_string())?;
        let session = writer.finish(conn)?;
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "EEG stream state is unavailable.".to_string())?;
        runtime.last_recording = Some(session);
    }

    let worker = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "EEG stream state is unavailable.".to_string())?;
        runtime.config = None;
        runtime.worker.take()
    };

    if let Some(worker) = worker {
        worker.stop();
    }

    Ok(())
}
```

- [ ] **Step 4: Implement server loop**

Implement `start_server` in `server.rs` with `TcpListener`, parser, aggregator, and Tauri emit. Use an accept timeout so shutdown can exit:

```rust
use std::{
    io::Read,
    net::{TcpListener, TcpStream},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tauri::Emitter;

use super::{
    buffer::{RealtimeBlockAggregator, EEG_SAMPLE_BLOCK_EVENT},
    protocol::{ParsedFrame, ProtocolParser},
};

pub fn start_server(app: AppHandle, config: EegStreamConfig) -> Result<EegServerWorker, String> {
    let listener = TcpListener::bind(format!("{}:{}", config.bind_host, config.tcp_port))
        .map_err(|_| "Failed to bind EEG TCP server.".to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "Failed to configure EEG TCP server.".to_string())?;

    let stop_requested = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop_requested);
    let join_handle = thread::spawn(move || {
        while !stop_for_thread.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _addr)) => {
                    let app = app.clone();
                    let config = config.clone();
                    let stop = Arc::clone(&stop_for_thread);
                    thread::spawn(move || handle_stream(app, config, stop, stream));
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(20));
                }
                Err(_) => break,
            }
        }
    });

    Ok(EegServerWorker {
        stop_requested,
        join_handle: Some(join_handle),
    })
}

fn handle_stream(
    app: AppHandle,
    config: EegStreamConfig,
    stop_requested: Arc<AtomicBool>,
    mut stream: TcpStream,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
    let mut parser = ProtocolParser::new();
    let mut aggregator = match RealtimeBlockAggregator::new(config.sample_rate_hz, config.block_interval_ms) {
        Ok(aggregator) => aggregator,
        Err(_) => return,
    };
    let mut latest_trigger = None;
    let mut buffer = [0_u8; 4096];

    while !stop_requested.load(Ordering::Relaxed) {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(read_count) => {
                for frame in parser.push_bytes(&buffer[..read_count]) {
                    match frame {
                        ParsedFrame::Trigger { value, .. } => {
                            if value != 0 {
                                latest_trigger = Some(value);
                            }
                        }
                        ParsedFrame::Eeg { samples_uv, .. } => {
                            if let Some(block) = aggregator.push_sample(
                                samples_uv,
                                latest_trigger.take(),
                                current_time_ms(),
                            ) {
                                let _ = app.emit(EEG_SAMPLE_BLOCK_EVENT, block);
                            }
                        }
                    }
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(_) => break,
        }
    }
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}
```

- [ ] **Step 5: Wire `lib.rs` stream commands to new signatures**

Modify imports and command definitions:

```rust
#[tauri::command]
fn start_eeg_stream(
    app: tauri::AppHandle,
    state: State<'_, EegStreamState>,
    config: Option<EegStreamConfig>,
) -> Result<EegStreamInfo, String> {
    eeg::start_stream(app, &state, config)
}

#[tauri::command]
fn stop_eeg_stream(
    db: State<'_, AppDb>,
    state: State<'_, EegStreamState>,
) -> Result<(), String> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;
    eeg::stop_stream(&state, Some(&conn))
}
```

- [ ] **Step 6: Run Rust tests**

Run:

```bash
cd src-tauri
cargo test --lib
```

Expected: all Rust library tests pass.

- [ ] **Step 7: Commit Task 5**

```bash
git add src-tauri/src/eeg/mod.rs src-tauri/src/eeg/server.rs src-tauri/src/lib.rs
git commit -m "feat(eeg): run rust tcp device server"
```

---

### Task 6: Record Samples from Runtime

**Files:**
- Modify: `src-tauri/src/eeg/mod.rs`
- Modify: `src-tauri/src/eeg/server.rs`

- [ ] **Step 1: Share recording state with server workers**

Change `EegStreamState` to store `Arc<Mutex<EegRuntime>>`:

```rust
#[derive(Default)]
pub struct EegStreamState {
    inner: Arc<Mutex<EegRuntime>>,
}
```

Make `EegRuntime` visible to `server.rs`:

```rust
pub(crate) struct EegRuntime {
    pub(crate) config: Option<EegStreamConfig>,
    pub(crate) recording: Option<RecordingWriter>,
    pub(crate) last_recording: Option<EegRecordingSession>,
    pub(crate) worker: Option<server::EegServerWorker>,
}
```

Change `server::start_server` signature:

```rust
pub fn start_server(
    app: AppHandle,
    config: EegStreamConfig,
    runtime: Arc<Mutex<super::EegRuntime>>,
) -> Result<EegServerWorker, String>
```

Pass `Arc::clone(&state.inner)` from `start_stream`.

- [ ] **Step 2: Write direct runtime recording helper**

Add helper in `server.rs`:

```rust
fn write_recording_sample(
    runtime: &Arc<Mutex<super::EegRuntime>>,
    samples_uv: &[f32; super::protocol::EEG_CHANNEL_COUNT],
    trigger: i32,
) {
    if let Ok(mut runtime) = runtime.lock() {
        if let Some(writer) = runtime.recording.as_mut() {
            let _ = writer.write_sample(samples_uv, trigger);
        }
    }
}
```

- [ ] **Step 3: Call recording helper on every EEG frame**

Inside `ParsedFrame::Eeg` handling in `handle_stream`:

```rust
let trigger = latest_trigger.take();
write_recording_sample(&runtime, &samples_uv, trigger.unwrap_or(0) as i32);
if let Some(block) = aggregator.push_sample(samples_uv, trigger, current_time_ms()) {
    let _ = app.emit(EEG_SAMPLE_BLOCK_EVENT, block);
}
```

- [ ] **Step 4: Run Rust tests**

Run:

```bash
cd src-tauri
cargo test --lib
```

Expected: all Rust library tests still pass.

- [ ] **Step 5: Commit Task 6**

```bash
git add src-tauri/src/eeg/mod.rs src-tauri/src/eeg/server.rs
git commit -m "feat(eeg): record incoming device samples"
```

---

### Task 7: Frontend Channel Model

**Files:**
- Modify: `src/eeg/channels.ts`
- Modify: `src/eeg/eegRingBuffer.test.ts`

- [ ] **Step 1: Write channel model tests**

Add to `src/eeg/eegRingBuffer.test.ts`:

```ts
import { DEFAULT_VISIBLE_EEG_CHANNEL_IDS, MAX_VISIBLE_EEG_CHANNELS } from './channels';

it('defines 32 available channels and defaults to ch01 through ch16', () => {
  expect(DEFAULT_EEG_CHANNELS).toHaveLength(32);
  expect(DEFAULT_EEG_CHANNELS[0]).toMatchObject({ id: 'ch01', label: 'CH01', unit: 'uV' });
  expect(DEFAULT_EEG_CHANNELS[31]).toMatchObject({ id: 'ch32', label: 'CH32', unit: 'uV' });
  expect(MAX_VISIBLE_EEG_CHANNELS).toBe(16);
  expect(DEFAULT_VISIBLE_EEG_CHANNEL_IDS).toEqual([
    'ch01',
    'ch02',
    'ch03',
    'ch04',
    'ch05',
    'ch06',
    'ch07',
    'ch08',
    'ch09',
    'ch10',
    'ch11',
    'ch12',
    'ch13',
    'ch14',
    'ch15',
    'ch16',
  ]);
});

it('can ingest 32-channel payloads while displaying a selected 16-channel subset', () => {
  const buffer = new EegRingBuffer(DEFAULT_EEG_CHANNELS, 2);
  const samples = DEFAULT_EEG_CHANNELS.map((_, channelIndex) => [
    channelIndex,
    channelIndex + 100,
  ]);

  buffer.appendPayload(makePayload(1, 0, samples));
  const snapshot = buffer.toDisplayData(new Set(DEFAULT_VISIBLE_EEG_CHANNEL_IDS), 5);

  expect(snapshot.visibleChannels).toHaveLength(16);
  expect(snapshot.visibleChannels[0].id).toBe('ch01');
  expect(snapshot.visibleChannels[15].id).toBe('ch16');
  expect(snapshot.seriesByChannel.ch01).toEqual([0, 100]);
  expect(snapshot.seriesByChannel.ch16).toEqual([15, 115]);
});
```

Update existing `fp1`, `fp2`, `f3` expectations to `ch01`, `ch02`, `ch03`.

- [ ] **Step 2: Run frontend tests and verify failure**

Run:

```bash
npm test -- src/eeg/eegRingBuffer.test.ts
```

Expected: channel tests fail because channels are still montage names.

- [ ] **Step 3: Implement 32-channel list**

Replace `src/eeg/channels.ts`:

```ts
import type { EegChannel } from './types';

export const MAX_VISIBLE_EEG_CHANNELS = 16;

export const DEFAULT_EEG_CHANNELS: EegChannel[] = Array.from({ length: 32 }, (_, index) => {
  const channelNumber = String(index + 1).padStart(2, '0');

  return {
    id: `ch${channelNumber}`,
    label: `CH${channelNumber}`,
    unit: 'uV',
  };
});

export const DEFAULT_VISIBLE_EEG_CHANNEL_IDS = DEFAULT_EEG_CHANNELS.slice(
  0,
  MAX_VISIBLE_EEG_CHANNELS,
).map((channel) => channel.id);
```

- [ ] **Step 4: Run channel tests**

Run:

```bash
npm test -- src/eeg/eegRingBuffer.test.ts
```

Expected: `eegRingBuffer` tests pass.

- [ ] **Step 5: Commit Task 7**

```bash
git add src/eeg/channels.ts src/eeg/eegRingBuffer.test.ts
git commit -m "feat(eeg): expose thirty two display channels"
```

---

### Task 8: Frontend Recording API and User Binding

**Files:**
- Modify: `src/eeg/types.ts`
- Modify: `src/eeg/eegApi.ts`
- Modify: `src/eeg/EegSessionContext.tsx`

- [ ] **Step 1: Add TypeScript DTOs**

Add to `src/eeg/types.ts`:

```ts
export interface EegStreamConfig {
  bindHost: string;
  tcpPort: number;
  deviceHost: string;
  deviceUdpPort: number;
  eegDeviceIp: string;
  triggerDeviceIp: string;
  sampleRateHz: number;
  blockIntervalMs: number;
}

export interface StartEegRecordingInput {
  userId: string;
  username: string;
}

export interface EegRecordingSession {
  id: string;
  userId: string;
  username: string;
  sessionDir: string;
  eegFile: string;
  triggerFile: string;
  metadataFile: string;
  sampleRateHz: number;
  channelCount: number;
  sampleCount: number;
  durationSeconds: number | null;
  startedAt: string;
  endedAt: string | null;
}

export interface EegStatus {
  isStreaming: boolean;
  isRecording: boolean;
  sampleRateHz: number;
  blockIntervalMs: number;
  channelIds: string[];
  activeRecording: EegRecordingSession | null;
}
```

- [ ] **Step 2: Add API wrappers**

Modify `src/eeg/eegApi.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import type {
  EegRecordingSession,
  EegStatus,
  EegStreamConfig,
  EegStreamInfo,
  StartEegRecordingInput,
} from './types';

export const startEegStream = (config?: Partial<EegStreamConfig>): Promise<EegStreamInfo> =>
  invoke('start_eeg_stream', { config: config ?? null });

export const stopEegStream = (): Promise<void> => invoke('stop_eeg_stream');

export const getEegStatus = (): Promise<EegStatus> => invoke('get_eeg_status');

export const startEegRecording = (
  input: StartEegRecordingInput,
): Promise<EegRecordingSession> => invoke('start_eeg_recording', { input });

export const stopEegRecording = (): Promise<EegRecordingSession> => invoke('stop_eeg_recording');

export const listEegSessions = (userId: string): Promise<EegRecordingSession[]> =>
  invoke('list_eeg_sessions', { userId });
```

- [ ] **Step 3: Bind recording actions to current user**

In `src/eeg/EegSessionContext.tsx`, import auth context and recording APIs:

```ts
import { useAuth } from '../auth/AuthContext';
import { startEegRecording, stopEegRecording } from './eegApi';
```

Inside provider:

```ts
const { currentUser } = useAuth();
```

Change record start action:

```ts
const startRecord = useCallback(async () => {
  if (!currentUser) {
    dispatch({ type: 'record_failed', error: 'Please log in before recording EEG.' });
    return;
  }

  dispatch({ type: 'start_record' });
  try {
    await startEegRecording({
      userId: currentUser.id,
      username: currentUser.username,
    });
  } catch (error) {
    dispatch({
      type: 'record_failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}, [currentUser]);
```

Change stop record action:

```ts
const stopRecord = useCallback(async () => {
  try {
    await stopEegRecording();
    dispatch({ type: 'stop_record' });
  } catch (error) {
    dispatch({
      type: 'record_failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}, []);
```

- [ ] **Step 4: Run typecheck/build**

Run:

```bash
npm run build
```

Expected: build passes after adapting reducer action names if the current reducer uses different names.

- [ ] **Step 5: Commit Task 8**

```bash
git add src/eeg/types.ts src/eeg/eegApi.ts src/eeg/EegSessionContext.tsx
git commit -m "feat(eeg): bind recordings to current user"
```

---

### Task 9: Frontend 32 Pick 16 Channel Selector

**Files:**
- Modify: `src/eeg/eegSessionState.ts`
- Modify: `src/eeg/eegSessionState.test.ts`
- Modify: `src/eeg/EegSessionContext.tsx`
- Modify: `src/eeg/EegChannelList.tsx`
- Modify: `src/eeg/EegWaveformPanel.tsx`

- [ ] **Step 1: Add reducer tests for visible channel cap**

Add to `src/eeg/eegSessionState.test.ts`:

```ts
import { DEFAULT_VISIBLE_EEG_CHANNEL_IDS, MAX_VISIBLE_EEG_CHANNELS } from './channels';

it('defaults visible EEG channels to ch01 through ch16', () => {
  expect(initialEegSessionState.visibleChannelIds).toEqual(DEFAULT_VISIBLE_EEG_CHANNEL_IDS);
});

it('caps visible EEG channel selection at sixteen channels', () => {
  const allChannels = Array.from({ length: 32 }, (_, index) => `ch${String(index + 1).padStart(2, '0')}`);

  const state = eegSessionReducer(initialEegSessionState, {
    type: 'set_visible_channels',
    channelIds: allChannels,
  });

  expect(state.visibleChannelIds).toHaveLength(MAX_VISIBLE_EEG_CHANNELS);
  expect(state.visibleChannelIds[0]).toBe('ch01');
  expect(state.visibleChannelIds[15]).toBe('ch16');
});
```

- [ ] **Step 2: Run reducer tests and verify failure**

Run:

```bash
npm test -- src/eeg/eegSessionState.test.ts
```

Expected: tests fail until visible channel state/action exists.

- [ ] **Step 3: Add visible channel state**

Modify `src/eeg/eegSessionState.ts`:

```ts
import { DEFAULT_VISIBLE_EEG_CHANNEL_IDS, MAX_VISIBLE_EEG_CHANNELS } from './channels';
```

Add field:

```ts
visibleChannelIds: string[];
```

Initialize:

```ts
visibleChannelIds: DEFAULT_VISIBLE_EEG_CHANNEL_IDS,
```

Add action:

```ts
| { type: 'set_visible_channels'; channelIds: string[] }
```

Add reducer case:

```ts
case 'set_visible_channels':
  return {
    ...state,
    visibleChannelIds: action.channelIds.slice(0, MAX_VISIBLE_EEG_CHANNELS),
  };
```

- [ ] **Step 4: Wire context value**

In `src/eeg/EegSessionContext.tsx`, expose:

```ts
visibleChannelIds: state.visibleChannelIds,
setVisibleChannelIds: (channelIds: string[]) =>
  dispatch({ type: 'set_visible_channels', channelIds }),
```

Ensure the context type includes:

```ts
visibleChannelIds: string[];
setVisibleChannelIds: (channelIds: string[]) => void;
```

- [ ] **Step 5: Implement channel list selection**

In `src/eeg/EegChannelList.tsx`, render all `DEFAULT_EEG_CHANNELS` and checkbox/toggle state:

```tsx
const selected = new Set(visibleChannelIds);

const toggleChannel = (channelId: string) => {
  if (selected.has(channelId)) {
    setVisibleChannelIds(visibleChannelIds.filter((id) => id !== channelId));
    return;
  }

  if (visibleChannelIds.length >= MAX_VISIBLE_EEG_CHANNELS) {
    return;
  }

  setVisibleChannelIds([...visibleChannelIds, channelId]);
};
```

Disable unchecked controls when 16 are already selected:

```tsx
disabled={!selected.has(channel.id) && visibleChannelIds.length >= MAX_VISIBLE_EEG_CHANNELS}
```

- [ ] **Step 6: Use selected set in waveform**

In `src/eeg/EegWaveformPanel.tsx`, call display data with:

```ts
const selectedChannelIds = new Set(visibleChannelIds);
const displayData = ringBuffer.toDisplayData(selectedChannelIds, secondsToShow);
```

- [ ] **Step 7: Run frontend tests/build**

Run:

```bash
npm test -- src/eeg/eegSessionState.test.ts src/eeg/eegRingBuffer.test.ts
npm run build
```

Expected: selected channel tests pass and production build passes.

- [ ] **Step 8: Commit Task 9**

```bash
git add src/eeg/eegSessionState.ts src/eeg/eegSessionState.test.ts src/eeg/EegSessionContext.tsx src/eeg/EegChannelList.tsx src/eeg/EegWaveformPanel.tsx
git commit -m "feat(eeg): select sixteen visible channels"
```

---

### Task 10: Remove Simulator Conflict and Full Verification

**Files:**
- Delete: `src-tauri/src/eeg.rs`
- Verify: all modified files

- [ ] **Step 1: Delete old simulator file**

Delete `src-tauri/src/eeg.rs`. Rust module resolution must use `src-tauri/src/eeg/mod.rs`; keeping both files will fail compilation.

- [ ] **Step 2: Run formatting**

Run:

```bash
cd src-tauri
cargo fmt
```

Expected: Rust files formatted.

- [ ] **Step 3: Run Rust tests**

Run:

```bash
cd src-tauri
cargo test --lib
```

Expected: all Rust library tests pass.

- [ ] **Step 4: Run frontend tests**

Run:

```bash
npm test -- src/eeg/eegRingBuffer.test.ts src/eeg/eegSessionState.test.ts
```

Expected: EEG frontend tests pass.

- [ ] **Step 5: Run full build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 6: Inspect git diff**

Run:

```bash
git status --short
git diff -- src-tauri/src src/eeg docs/superpowers/plans/2026-06-12-rust-eeg-device-server.md
```

Expected: only EEG backend/frontend files and the plan changed. Unrelated files such as `agentdb.rvf` and `agentdb.rvf.lock` are not touched.

- [ ] **Step 7: Commit final cleanup**

```bash
git add src-tauri/src src/eeg docs/superpowers/plans/2026-06-12-rust-eeg-device-server.md
git commit -m "feat(eeg): replace simulator with rust device server"
```

---

## Self-Review

- Spec coverage: TCP server, UDP start instruction, protocol parsing, realtime 32-channel event payloads, `.bin + metadata.json` recording, SQLite `eeg_sessions`, user validation, default `ch01`-`ch16`, 32-pick-16 display, and verification are all mapped to tasks.
- Placeholder scan: No task uses `TBD`, `TODO`, or unbounded "add tests" language. Each test and implementation step includes concrete code or exact commands.
- Type consistency: Rust names are `EegStreamConfig`, `EegStreamInfo`, `EegStatus`, `StartEegRecordingInput`, `EegRecordingSession`; TypeScript mirrors camelCase command payloads. Event payload stays `eeg://sample-block` with `channelIds` and channel-major `samples`.
