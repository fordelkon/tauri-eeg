use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, Error as SqlError};
use serde::Serialize;
use std::{
    fs::{self, File},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
};

use super::{
    buffer::default_channel_ids,
    protocol::EEG_CHANNEL_COUNT,
    session::{EegRecordingSession, StartEegRecordingInput},
    EegStreamConfig,
};

const EEG_FILE_NAME: &str = "eeg.f32le.bin";
const TRIGGER_FILE_NAME: &str = "trigger.i32le.bin";
const METADATA_FILE_NAME: &str = "metadata.json";
const DISPLAY_CHANNEL_LIMIT: usize = 16;

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
}

#[derive(Debug)]
pub struct RecordingWriter {
    session: EegRecordingSession,
    eeg_writer: BufWriter<File>,
    trigger_writer: BufWriter<File>,
    started_at: DateTime<Utc>,
}

impl RecordingWriter {
    pub fn start(
        conn: &Connection,
        base_dir: &Path,
        input: StartEegRecordingInput,
        config: &EegStreamConfig,
    ) -> Result<Self, String> {
        let user_id = validate_user(conn, input)?;
        let started_at = Utc::now();
        let session_id = started_at.format("session_%Y%m%d_%H%M%S").to_string();
        let user_dir = safe_user_dir_segment(&user_id.user_id)?;
        let session_dir = unique_session_dir(&base_dir.join(user_dir), &session_id)?;
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
            started_at,
        })
    }

    pub fn session(&self) -> EegRecordingSession {
        self.session.clone()
    }

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
            .map_err(|_| "Failed to write trigger sample.".to_string())?;
        self.session.sample_count += 1;
        Ok(())
    }

    pub fn finish(mut self, conn: &Connection) -> Result<EegRecordingSession, String> {
        self.eeg_writer
            .flush()
            .map_err(|_| "Failed to flush EEG binary file.".to_string())?;
        self.trigger_writer
            .flush()
            .map_err(|_| "Failed to flush trigger binary file.".to_string())?;

        let ended_at = Utc::now();
        let duration_seconds = (ended_at - self.started_at)
            .to_std()
            .map(|duration| duration.as_secs_f64())
            .unwrap_or_default();
        self.session.ended_at = Some(ended_at.to_rfc3339());
        self.session.duration_seconds = Some(duration_seconds);

        write_metadata(&self.session, duration_seconds)?;
        insert_eeg_session(conn, &self.session)?;
        Ok(self.session)
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
        .prepare(
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

fn safe_user_dir_segment(user_id: &str) -> Result<String, String> {
    if user_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Ok(user_id.to_string());
    }

    Err("User id contains unsupported path characters.".to_string())
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

fn write_metadata(session: &EegRecordingSession, duration_seconds: f64) -> Result<(), String> {
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
    };

    let metadata_path = Path::new(&session.session_dir).join(METADATA_FILE_NAME);
    let json = serde_json::to_string_pretty(&metadata)
        .map_err(|_| "Failed to serialize EEG metadata.".to_string())?;
    fs::write(metadata_path, json).map_err(|_| "Failed to write EEG metadata.".to_string())
}

fn insert_eeg_session(conn: &Connection, session: &EegRecordingSession) -> Result<(), String> {
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
            },
            &EegStreamConfig::default(),
        );

        assert_eq!(result.unwrap_err(), "User not found.");
    }

    #[test]
    fn writes_sample_major_binaries_metadata_and_user_bound_row() {
        let conn = setup_conn();
        let base_dir = temp_recording_dir();
        let mut writer = RecordingWriter::start(
            &conn,
            &base_dir,
            StartEegRecordingInput {
                user_id: "user-1".to_string(),
                username: "alice".to_string(),
            },
            &EegStreamConfig::default(),
        )
        .expect("start writer");

        let mut sample = [0.0_f32; EEG_CHANNEL_COUNT];
        sample[0] = 1.25;
        sample[31] = -2.5;
        writer.write_sample(&sample, 3).expect("write sample");
        let session = writer.finish(&conn).expect("finish writer");

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

        let _ = fs::remove_dir_all(base_dir);
    }
}
