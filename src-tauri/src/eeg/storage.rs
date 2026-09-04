use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, Error as SqlError};
use serde::Serialize;
use std::{
    collections::VecDeque,
    fs::{self, File},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    sync::mpsc::{self, RecvTimeoutError},
    thread::{self, JoinHandle},
    time::Duration,
};

use super::{
    buffer::default_channel_ids,
    paradigm::{ParadigmInfo, TriggerObservation},
    protocol::EEG_CHANNEL_COUNT,
    session::{EegRecordingSession, StartEegRecordingInput},
    EegStreamConfig,
};

const EEG_FILE_NAME: &str = "eeg.f32le.bin";
const TRIGGER_FILE_NAME: &str = "trigger.i32le.bin";
const METADATA_FILE_NAME: &str = "metadata.json";
const TRIAL_EVENTS_FILE_NAME: &str = "trial-events.jsonl";
const TRIALS_FILE_NAME: &str = "trials.jsonl";
const TRAINING_MANIFEST_FILE_NAME: &str = "training-manifest.json";
const DISPLAY_CHANNEL_LIMIT: usize = 16;
const MAX_TRIGGER_OBSERVATIONS: usize = 4096;
/// How long the writer waits for the next message before re-checking the
/// shutdown flag; bounds stop() latency without waking the thread while the
/// sample stream is flowing.
const WRITER_POLL_INTERVAL: Duration = Duration::from_millis(20);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingMetadata {
    format_version: u8,
    session_id: String,
    user_id: String,
    username: String,
    sample_rate_hz: u32,
    channel_count: usize,
    channel_ids: Vec<String>,
    display_channel_limit: usize,
    eeg_file: String,
    eeg_dtype: String,
    eeg_layout: String,
    trigger_file: String,
    trigger_dtype: String,
    sample_count: u64,
    started_at: String,
    ended_at: String,
    duration_seconds: f64,
    paradigm: Option<ParadigmInfo>,
}

#[derive(Debug)]
pub struct RecordingWriter {
    session: EegRecordingSession,
    eeg_writer: BufWriter<File>,
    trigger_writer: BufWriter<File>,
    trial_events_writer: Option<BufWriter<File>>,
    trials_writer: Option<BufWriter<File>>,
    paradigm: Option<ParadigmInfo>,
    started_at: DateTime<Utc>,
    /// Reused scratch holding the little-endian encoding of one incoming
    /// sample block (all channels), so each block is flushed to the EEG file
    /// with a single write_all instead of one 4-byte write per channel.
    eeg_block_scratch: Vec<u8>,
}

/// Encodes one incoming sample block (every channel of the sample) as
/// little-endian f32 into `scratch`, cleared first so the buffer is reused
/// across blocks. Produces byte-for-byte the same output as writing each
/// channel with `write_all(&sample.to_le_bytes())` in channel order.
fn encode_sample_block(samples_uv: &[f32; EEG_CHANNEL_COUNT], scratch: &mut Vec<u8>) {
    scratch.clear();
    for sample in samples_uv {
        scratch.extend_from_slice(&sample.to_le_bytes());
    }
}

impl RecordingWriter {
    pub fn start(
        conn: &Connection,
        base_dir: &Path,
        input: StartEegRecordingInput,
        config: &EegStreamConfig,
    ) -> Result<Self, String> {
        let paradigm = input.paradigm.clone();
        let user_id = validate_user(conn, input)?;
        let started_at = Utc::now();
        let session_id = started_at.format("session_%Y%m%d_%H%M%S").to_string();
        let roots = crate::storage_paths::user_storage_roots(base_dir, &user_id.username)?;
        let session_dir = unique_session_dir(&roots.eeg_recordings_dir, &session_id)?;
        fs::create_dir_all(&session_dir)
            .map_err(|_| "Failed to create EEG session directory.".to_string())?;

        let eeg_path = session_dir.join(EEG_FILE_NAME);
        let trigger_path = session_dir.join(TRIGGER_FILE_NAME);
        let eeg_writer = BufWriter::new(
            File::create(&eeg_path).map_err(|_| "Failed to create EEG binary file.".to_string())?,
        );
        let trigger_writer = BufWriter::new(
            File::create(&trigger_path)
                .map_err(|_| "Failed to create trigger binary file.".to_string())?,
        );

        // Paradigm sessions additionally keep the trial event and record logs.
        let (trial_events_writer, trials_writer) = if paradigm.is_some() {
            let events = BufWriter::new(
                File::create(session_dir.join(TRIAL_EVENTS_FILE_NAME))
                    .map_err(|_| "Failed to create trial events file.".to_string())?,
            );
            let trials = BufWriter::new(
                File::create(session_dir.join(TRIALS_FILE_NAME))
                    .map_err(|_| "Failed to create trials file.".to_string())?,
            );
            (Some(events), Some(trials))
        } else {
            (None, None)
        };

        let session = EegRecordingSession {
            id: session_dir
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(&session_id)
                .to_string(),
            user_id: user_id.user_id,
            username: user_id.username,
            session_dir: session_dir.to_string_lossy().to_string(),
            eeg_file: EEG_FILE_NAME.to_string(),
            trigger_file: TRIGGER_FILE_NAME.to_string(),
            metadata_file: METADATA_FILE_NAME.to_string(),
            sample_rate_hz: config.sample_rate_hz,
            channel_count: EEG_CHANNEL_COUNT,
            sample_count: 0,
            duration_seconds: None,
            started_at: started_at.to_rfc3339(),
            ended_at: None,
        };

        Ok(Self {
            session,
            eeg_writer,
            trigger_writer,
            trial_events_writer,
            trials_writer,
            paradigm,
            started_at,
            eeg_block_scratch: Vec::with_capacity(EEG_CHANNEL_COUNT * std::mem::size_of::<f32>()),
        })
    }

    pub fn session(&self) -> EegRecordingSession {
        self.session.clone()
    }

    fn write_sample(
        &mut self,
        samples_uv: &[f32; EEG_CHANNEL_COUNT],
        trigger: i32,
    ) -> Result<(), String> {
        // Batch-encode the whole incoming block into the reused scratch buffer
        // and issue ONE write_all: one ~128-byte copy into the BufWriter per
        // sample instead of 32 separate 4-byte writes. The byte layout is
        // unchanged (sample-major little-endian f32, channel order preserved).
        encode_sample_block(samples_uv, &mut self.eeg_block_scratch);
        self.eeg_writer
            .write_all(&self.eeg_block_scratch)
            .map_err(|_| "Failed to write EEG sample.".to_string())?;
        self.trigger_writer
            .write_all(&trigger.to_le_bytes())
            .map_err(|_| "Failed to write trigger sample.".to_string())?;
        self.session.sample_count += 1;
        Ok(())
    }

    /// Flushes files and writes metadata. The database row is inserted by the
    /// caller after the writer thread joins (see `insert_eeg_session`).
    fn finalize(mut self) -> Result<EegRecordingSession, String> {
        self.eeg_writer
            .flush()
            .map_err(|_| "Failed to flush EEG binary file.".to_string())?;
        self.trigger_writer
            .flush()
            .map_err(|_| "Failed to flush trigger binary file.".to_string())?;
        if let Some(writer) = self.trial_events_writer.as_mut() {
            writer
                .flush()
                .map_err(|_| "Failed to flush trial events file.".to_string())?;
        }
        if let Some(writer) = self.trials_writer.as_mut() {
            writer
                .flush()
                .map_err(|_| "Failed to flush trials file.".to_string())?;
        }

        let ended_at = Utc::now();
        let duration_seconds = (ended_at - self.started_at)
            .to_std()
            .map(|duration| duration.as_secs_f64())
            .unwrap_or_default();
        self.session.ended_at = Some(ended_at.to_rfc3339());
        self.session.duration_seconds = Some(duration_seconds);

        write_metadata(&self.session, duration_seconds, self.paradigm.as_ref())?;
        Ok(self.session)
    }

    /// Appends one pre-serialized JSON line to trial-events.jsonl. Ignored for
    /// non-paradigm sessions, which never create the file.
    fn append_trial_event(&mut self, line: &str) -> Result<(), String> {
        append_jsonl_line(
            self.trial_events_writer.as_mut(),
            line,
            "Failed to write trial event.",
        )
    }

    /// Appends one pre-serialized JSON line to trials.jsonl.
    fn append_trial_record(&mut self, line: &str) -> Result<(), String> {
        append_jsonl_line(
            self.trials_writer.as_mut(),
            line,
            "Failed to write trial record.",
        )
    }

    /// Overwrites training-manifest.json with the pretty JSON payload.
    fn write_manifest(&self, json: &str) -> Result<(), String> {
        let path = Path::new(&self.session.session_dir).join(TRAINING_MANIFEST_FILE_NAME);
        fs::write(path, json).map_err(|_| "Failed to write training manifest.".to_string())
    }
}

fn append_jsonl_line(
    writer: Option<&mut BufWriter<File>>,
    line: &str,
    error: &str,
) -> Result<(), String> {
    match writer {
        Some(writer) => writer
            .write_all(line.as_bytes())
            .and_then(|()| writer.write_all(b"\n"))
            .map_err(|_| error.to_string()),
        None => Ok(()),
    }
}

/// Message sent to the recording writer thread: samples flow continuously,
/// paradigm trial logs and the final manifest arrive as pre-serialized JSON.
pub enum RecordingMessage {
    Sample {
        samples: [f32; EEG_CHANNEL_COUNT],
        trigger: i32,
    },
    /// One line appended to trial-events.jsonl (serialized JSON, no newline).
    TrialEvent(String),
    /// One line appended to trials.jsonl.
    TrialRecord(String),
    /// Overwrites training-manifest.json (pretty JSON).
    Manifest(String),
}

/// Owns the recording files on a dedicated thread so the sample path never
/// performs disk IO under the EEG runtime mutex. Dropping the sender side
/// (via `stop`) makes the thread flush and finalize the session; the shutdown
/// flag additionally ends the loop while an idle ingest thread still holds a
/// cached sender clone (see the generation-checked cache in server.rs), so
/// stop() stays deterministic even if that thread never sends again.
#[derive(Debug)]
pub struct RecordingWorker {
    session: EegRecordingSession,
    sample_count: Arc<AtomicU64>,
    trigger_observations: Arc<Mutex<VecDeque<TriggerObservation>>>,
    sender: mpsc::Sender<RecordingMessage>,
    shutdown: Arc<AtomicBool>,
    handle: Mutex<Option<JoinHandle<Result<EegRecordingSession, String>>>>,
}

impl RecordingWorker {
    pub fn start(writer: RecordingWriter) -> Self {
        let (sender, receiver) = mpsc::channel::<RecordingMessage>();
        let sample_count = Arc::new(AtomicU64::new(0));
        let trigger_observations: Arc<Mutex<VecDeque<TriggerObservation>>> =
            Arc::new(Mutex::new(VecDeque::new()));
        let count_for_thread = Arc::clone(&sample_count);
        let observations_for_thread = Arc::clone(&trigger_observations);
        let shutdown = Arc::new(AtomicBool::new(false));
        let shutdown_for_thread = Arc::clone(&shutdown);
        let session = writer.session();
        let handle = thread::Builder::new()
            .name("eeg-recording-writer".to_string())
            .spawn(move || {
                let mut writer = writer;
                // Everything already queued is drained even after the stop flag
                // is set; the flag only breaks the wait once the channel goes
                // quiet (or fully disconnects).
                loop {
                    match receiver.recv_timeout(WRITER_POLL_INTERVAL) {
                        Ok(message) => {
                            match message {
                                RecordingMessage::Sample { samples, trigger } => {
                                    writer.write_sample(&samples, trigger)?;
                                    let sample_index =
                                        count_for_thread.fetch_add(1, Ordering::Relaxed);
                                    if trigger != 0 {
                                        record_trigger_observation(
                                            &observations_for_thread,
                                            trigger,
                                            sample_index,
                                        );
                                    }
                                }
                                RecordingMessage::TrialEvent(line) => {
                                    writer.append_trial_event(&line)?
                                }
                                RecordingMessage::TrialRecord(line) => {
                                    writer.append_trial_record(&line)?
                                }
                                RecordingMessage::Manifest(json) => {
                                    writer.write_manifest(&json)?
                                }
                            }
                            continue;
                        }
                        Err(RecvTimeoutError::Disconnected) => break,
                        Err(RecvTimeoutError::Timeout) => {}
                    }
                    if shutdown_for_thread.load(Ordering::Acquire) {
                        break;
                    }
                }
                writer.finalize()
            })
            .expect("failed to spawn EEG recording writer thread");

        Self {
            session,
            sample_count,
            trigger_observations,
            sender,
            shutdown,
            handle: Mutex::new(Some(handle)),
        }
    }

    pub fn session(&self) -> EegRecordingSession {
        let mut session = self.session.clone();
        session.sample_count = self.sample_count.load(Ordering::Relaxed);
        session
    }

    pub fn sender(&self) -> mpsc::Sender<RecordingMessage> {
        self.sender.clone()
    }

    pub fn sample_count_handle(&self) -> Arc<AtomicU64> {
        Arc::clone(&self.sample_count)
    }

    pub fn trigger_observations_handle(&self) -> Arc<Mutex<VecDeque<TriggerObservation>>> {
        Arc::clone(&self.trigger_observations)
    }

    /// Snapshot of the observed trigger codes; part of the paradigm API
    /// (used by tests and status reporting outside the hot sample path).
    #[allow(dead_code)]
    pub fn trigger_observations(&self) -> Vec<TriggerObservation> {
        self.trigger_observations
            .lock()
            .map(|observations| observations.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Signals the writer to stop once the queue drains, drops the sample
    /// sender, joins the writer thread (flushing both files) and returns the
    /// finalized session, ready to be persisted.
    pub fn stop(self) -> Result<EegRecordingSession, String> {
        self.shutdown.store(true, Ordering::Release);
        drop(self.sender);
        let handle = self
            .handle
            .lock()
            .ok()
            .and_then(|mut handle| handle.take())
            .ok_or_else(|| "EEG recording writer already stopped.".to_string())?;
        handle
            .join()
            .map_err(|_| "EEG recording writer thread failed.".to_string())?
    }
}

/// Keeps at most MAX_TRIGGER_OBSERVATIONS entries, dropping the oldest.
fn record_trigger_observation(
    observations: &Arc<Mutex<VecDeque<TriggerObservation>>>,
    code: i32,
    sample_index: u64,
) {
    if let Ok(mut observations) = observations.lock() {
        if observations.len() >= MAX_TRIGGER_OBSERVATIONS {
            observations.pop_front();
        }
        observations.push_back(TriggerObservation {
            code,
            sample_index,
            timestamp: Utc::now().to_rfc3339(),
        });
    }
}

#[derive(Debug)]
struct ValidUser {
    user_id: String,
    username: String,
}

pub fn init_eeg_session_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS eeg_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            session_dir TEXT NOT NULL,
            eeg_file TEXT NOT NULL,
            trigger_file TEXT NOT NULL,
            metadata_file TEXT NOT NULL,
            sample_rate_hz INTEGER NOT NULL,
            channel_count INTEGER NOT NULL,
            sample_count INTEGER NOT NULL,
            duration_seconds REAL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_eeg_sessions_user_started
            ON eeg_sessions(user_id, started_at DESC);",
    )
    .map_err(|_| "Failed to initialize EEG session schema.".to_string())
}

pub fn list_eeg_sessions(
    conn: &Connection,
    user_id: &str,
) -> Result<Vec<EegRecordingSession>, String> {
    let user_id = user_id.trim();
    if user_id.is_empty() {
        return Err("User id is required.".to_string());
    }

    let mut stmt = conn
        .prepare_cached(
            "SELECT id, user_id, username, session_dir, eeg_file, trigger_file, metadata_file,
                sample_rate_hz, channel_count, sample_count, duration_seconds, started_at, ended_at
             FROM eeg_sessions
             WHERE user_id = ?1
             ORDER BY started_at DESC",
        )
        .map_err(|_| "Failed to load EEG sessions.".to_string())?;

    let rows = stmt
        .query_map(params![user_id], |row| {
            Ok(EegRecordingSession {
                id: row.get(0)?,
                user_id: row.get(1)?,
                username: row.get(2)?,
                session_dir: row.get(3)?,
                eeg_file: row.get(4)?,
                trigger_file: row.get(5)?,
                metadata_file: row.get(6)?,
                sample_rate_hz: row.get::<_, i64>(7)? as u32,
                channel_count: row.get::<_, i64>(8)? as usize,
                sample_count: row.get::<_, i64>(9)? as u64,
                duration_seconds: row.get(10)?,
                started_at: row.get(11)?,
                ended_at: row.get(12)?,
            })
        })
        .map_err(|_| "Failed to load EEG sessions.".to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Failed to load EEG sessions.".to_string())
}

pub(crate) fn insert_eeg_session(conn: &Connection, session: &EegRecordingSession) -> Result<(), String> {
    conn.execute(
        "INSERT INTO eeg_sessions
            (id, user_id, username, session_dir, eeg_file, trigger_file, metadata_file,
             sample_rate_hz, channel_count, sample_count, duration_seconds, started_at, ended_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            session.id,
            session.user_id,
            session.username,
            session.session_dir,
            session.eeg_file,
            session.trigger_file,
            session.metadata_file,
            session.sample_rate_hz,
            session.channel_count as i64,
            session.sample_count as i64,
            session.duration_seconds,
            session.started_at,
            session.ended_at,
            Utc::now().to_rfc3339(),
        ],
    )
    .map_err(|_| "Failed to save EEG session.".to_string())?;

    Ok(())
}

fn validate_user(conn: &Connection, input: StartEegRecordingInput) -> Result<ValidUser, String> {
    let user_id = input.user_id.trim();
    let username = input.username.trim();
    if user_id.is_empty() {
        return Err("User id is required.".to_string());
    }
    if username.is_empty() {
        return Err("Username is required.".to_string());
    }

    let result = conn.query_row(
        "SELECT username FROM users WHERE id = ?1",
        params![user_id],
        |row| row.get::<_, String>(0),
    );

    match result {
        Ok(stored_username) if stored_username == username => Ok(ValidUser {
            user_id: user_id.to_string(),
            username: username.to_string(),
        }),
        Ok(_) => Err("User identity does not match the logged-in account.".to_string()),
        Err(SqlError::QueryReturnedNoRows) => Err("User not found.".to_string()),
        Err(_) => Err("Failed to validate user.".to_string()),
    }
}

fn unique_session_dir(user_base_dir: &Path, session_id: &str) -> Result<PathBuf, String> {
    for suffix in 0..100 {
        let name = if suffix == 0 {
            session_id.to_string()
        } else {
            format!("{session_id}_{suffix:02}")
        };
        let candidate = user_base_dir.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("Failed to allocate EEG session directory.".to_string())
}

fn write_metadata(
    session: &EegRecordingSession,
    duration_seconds: f64,
    paradigm: Option<&ParadigmInfo>,
) -> Result<(), String> {
    let ended_at = session
        .ended_at
        .clone()
        .ok_or_else(|| "EEG session end time is unavailable.".to_string())?;
    let metadata = RecordingMetadata {
        format_version: 1,
        session_id: session.id.clone(),
        user_id: session.user_id.clone(),
        username: session.username.clone(),
        sample_rate_hz: session.sample_rate_hz,
        channel_count: session.channel_count,
        channel_ids: default_channel_ids(),
        display_channel_limit: DISPLAY_CHANNEL_LIMIT,
        eeg_file: EEG_FILE_NAME.to_string(),
        eeg_dtype: "float32_le".to_string(),
        eeg_layout: "sample_major".to_string(),
        trigger_file: TRIGGER_FILE_NAME.to_string(),
        trigger_dtype: "int32_le".to_string(),
        sample_count: session.sample_count,
        started_at: session.started_at.clone(),
        ended_at,
        duration_seconds,
        paradigm: paradigm.cloned(),
    };

    let metadata_path = Path::new(&session.session_dir).join(METADATA_FILE_NAME);
    let json = serde_json::to_string_pretty(&metadata)
        .map_err(|_| "Failed to serialize EEG metadata.".to_string())?;
    fs::write(metadata_path, json).map_err(|_| "Failed to write EEG metadata.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");
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
        .expect("create users table");
        conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at, updated_at)
                VALUES ('user-1', 'alice', 'hash', 'now', 'now')",
            [],
        )
        .expect("insert user");
        init_eeg_session_schema(&conn).expect("init eeg schema");
        conn
    }

    fn temp_recording_dir() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("tauri-eeg-storage-test-{suffix}"))
    }

    #[test]
    fn creates_eeg_sessions_schema() {
        let conn = setup_conn();
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
    fn rejects_recording_for_missing_user() {
        let conn = setup_conn();
        let base_dir = temp_recording_dir();

        let result = RecordingWriter::start(
            &conn,
            &base_dir,
            StartEegRecordingInput {
                user_id: "missing".to_string(),
                username: "alice".to_string(),
                paradigm: None,
            },
            &EegStreamConfig::default(),
        );

        assert_eq!(result.unwrap_err(), "User not found.");
    }

    #[test]
    fn batched_encoder_matches_naive_per_sample_encoding() {
        // Values that would expose any encoding shortcut: signed range,
        // subnormals and a NaN payload.
        let mut samples = [0.0_f32; EEG_CHANNEL_COUNT];
        for (index, sample) in samples.iter_mut().enumerate() {
            *sample = index as f32 * 0.5 - 3.25;
        }
        samples[0] = f32::NAN;
        samples[EEG_CHANNEL_COUNT - 1] = f32::MIN_POSITIVE * 7.0;

        // Fresh scratch on the first block...
        let mut scratch = Vec::new();
        encode_sample_block(&samples, &mut scratch);
        let mut naive = Vec::new();
        for sample in samples {
            naive.extend_from_slice(&sample.to_le_bytes());
        }
        assert_eq!(scratch, naive);
        assert_eq!(scratch.len(), EEG_CHANNEL_COUNT * std::mem::size_of::<f32>());

        // ...and reused scratch (with existing capacity) on the next block.
        let second = [-1.75e-12_f32; EEG_CHANNEL_COUNT];
        encode_sample_block(&second, &mut scratch);
        let mut naive_second = Vec::new();
        for sample in second {
            naive_second.extend_from_slice(&sample.to_le_bytes());
        }
        assert_eq!(scratch, naive_second);
    }

    #[test]
    fn writes_sample_major_binaries_metadata_and_user_bound_row() {
        let conn = setup_conn();
        let base_dir = temp_recording_dir();
        let writer = RecordingWriter::start(
            &conn,
            &base_dir,
            StartEegRecordingInput {
                user_id: "user-1".to_string(),
                username: "alice".to_string(),
                paradigm: None,
            },
            &EegStreamConfig::default(),
        )
        .expect("start writer");

        let worker = RecordingWorker::start(writer);

        let mut sample = [0.0_f32; EEG_CHANNEL_COUNT];
        sample[0] = 1.25;
        sample[31] = -2.5;
        worker
            .sender()
            .send(RecordingMessage::Sample {
                samples: sample,
                trigger: 3,
            })
            .expect("send sample to writer thread");

        // The writer thread updates the live sample count asynchronously.
        while worker.session().sample_count == 0 {
            thread::sleep(std::time::Duration::from_millis(1));
        }

        let session = worker.stop().expect("stop worker");
        insert_eeg_session(&conn, &session).expect("insert session row");

        let eeg_bytes =
            fs::read(Path::new(&session.session_dir).join(EEG_FILE_NAME)).expect("read eeg binary");
        let trigger_bytes = fs::read(Path::new(&session.session_dir).join(TRIGGER_FILE_NAME))
            .expect("read trigger binary");
        let metadata_text =
            fs::read_to_string(Path::new(&session.session_dir).join(METADATA_FILE_NAME))
                .expect("read metadata");
        let metadata: serde_json::Value =
            serde_json::from_str(&metadata_text).expect("parse metadata");
        let sessions = list_eeg_sessions(&conn, "user-1").expect("list sessions");

        assert_eq!(
            eeg_bytes.len(),
            EEG_CHANNEL_COUNT * std::mem::size_of::<f32>()
        );
        assert_eq!(&eeg_bytes[0..4], &1.25_f32.to_le_bytes());
        assert_eq!(&eeg_bytes[(31 * 4)..(32 * 4)], &(-2.5_f32).to_le_bytes());
        assert_eq!(trigger_bytes, 3_i32.to_le_bytes());
        assert_eq!(metadata["formatVersion"], 1);
        assert_eq!(metadata["userId"], "user-1");
        assert_eq!(metadata["channelCount"], 32);
        assert_eq!(metadata["eegDtype"], "float32_le");
        assert_eq!(metadata["eegLayout"], "sample_major");
        assert_eq!(metadata["sampleCount"], 1);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].user_id, "user-1");
        assert_eq!(sessions[0].sample_count, 1);
        assert!(Path::new(&session.session_dir).ends_with(
            Path::new("alice")
                .join("eeg_recordings")
                .join(&session.id)
        ));

        let _ = fs::remove_dir_all(base_dir);
    }
}
