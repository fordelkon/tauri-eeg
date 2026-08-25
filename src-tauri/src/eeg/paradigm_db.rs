use rusqlite::{params, Connection};

use super::paradigm::{
    LabelSource, ParadigmEmotion, ParadigmSessionKind, ParadigmSessionSummary, TrialQuality,
    TrialRecord, TrialStatus,
};
use super::paradigm_rules::{compute_acceptance, summarize_trials};

pub fn init_eeg_trial_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS eeg_trials (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            trial_index INTEGER NOT NULL,
            paradigm_emotion TEXT NOT NULL,
            trigger_class INTEGER NOT NULL,
            study_session TEXT,
            session_run_id TEXT,
            subject_id TEXT,
            video_id TEXT NOT NULL,
            video_path TEXT NOT NULL,
            status TEXT NOT NULL,
            quality TEXT,
            self_report_valence INTEGER,
            self_report_arousal INTEGER,
            self_report_dominance INTEGER,
            label_source TEXT,
            artifact_flags TEXT NOT NULL DEFAULT '[]',
            eeg_start_sample_index INTEGER NOT NULL,
            eeg_end_sample_index INTEGER,
            eeg_start_ts TEXT NOT NULL,
            eeg_end_ts TEXT,
            trigger_start_ts TEXT,
            trigger_end_ts TEXT,
            operator_notes TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES eeg_sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_eeg_trials_session
            ON eeg_trials(session_id, trial_index);",
    )
    .map_err(|_| "Failed to initialize EEG trial schema.".to_string())
}

/// The session row must already exist: trial rows reference it (and the user).
pub fn insert_eeg_trial(
    conn: &Connection,
    record: &TrialRecord,
    user_id: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO eeg_trials
            (id, session_id, user_id, trial_index, paradigm_emotion, trigger_class,
             study_session, session_run_id, subject_id, video_id, video_path,
             status, quality, self_report_valence, self_report_arousal, self_report_dominance,
             label_source, artifact_flags, eeg_start_sample_index, eeg_end_sample_index,
             eeg_start_ts, eeg_end_ts, trigger_start_ts, trigger_end_ts, operator_notes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                 ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26)",
        params![
            record.trial_id,
            record.session_id,
            user_id,
            record.trial_index,
            record.paradigm_emotion.wire_str(),
            record.trigger_class,
            record.study_session.as_str(),
            record.session_run_id,
            record.subject_id,
            record.video_id,
            record.video_path,
            record.status.as_str(),
            record.quality.map(|quality| quality.as_str()),
            record.self_report_valence,
            record.self_report_arousal,
            record.self_report_dominance,
            record.label_source.map(|source| source.as_str()),
            artifact_flags_json(record),
            record.eeg_start_sample_index as i64,
            record.eeg_end_sample_index.map(|end| end as i64),
            record.eeg_start_ts,
            record.eeg_end_ts,
            record.trigger_start_ts,
            record.trigger_end_ts,
            record.operator_notes,
            record.created_at,
        ],
    )
    .map_err(|_| "Failed to save EEG trial.".to_string())?;

    Ok(())
}

pub fn list_eeg_trials_for_session(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<TrialRecord>, String> {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return Err("Session id is required.".to_string());
    }

    let mut stmt = conn
        .prepare_cached(
            "SELECT t.id, t.session_id, t.study_session, t.subject_id, t.session_run_id,
                t.trial_index, t.status, t.paradigm_emotion, t.trigger_class, t.video_id,
                t.video_path, t.trigger_start_ts, t.trigger_end_ts, t.eeg_start_ts, t.eeg_end_ts,
                t.eeg_start_sample_index, t.eeg_end_sample_index,
                s.sample_rate_hz, s.channel_count, s.session_dir,
                t.self_report_valence, t.self_report_arousal, t.self_report_dominance,
                t.quality, t.label_source, t.artifact_flags, t.operator_notes, t.created_at
             FROM eeg_trials t
             JOIN eeg_sessions s ON s.id = t.session_id
             WHERE t.session_id = ?1
             ORDER BY t.trial_index ASC",
        )
        .map_err(|_| "Failed to load EEG trials.".to_string())?;

    let rows = stmt
        .query_map(params![session_id], |row| {
            Ok(TrialRow {
                id: row.get(0)?,
                session_id: row.get(1)?,
                study_session: row.get(2)?,
                subject_id: row.get(3)?,
                session_run_id: row.get(4)?,
                trial_index: row.get(5)?,
                status: row.get(6)?,
                paradigm_emotion: row.get(7)?,
                trigger_class: row.get::<_, i64>(8)? as u8,
                video_id: row.get(9)?,
                video_path: row.get(10)?,
                trigger_start_ts: row.get(11)?,
                trigger_end_ts: row.get(12)?,
                eeg_start_ts: row.get(13)?,
                eeg_end_ts: row.get(14)?,
                eeg_start_sample_index: row.get::<_, i64>(15)? as u64,
                eeg_end_sample_index: row.get::<_, Option<i64>>(16)?.map(|end| end as u64),
                sample_rate_hz: row.get::<_, i64>(17)? as u32,
                channel_count: row.get::<_, i64>(18)? as usize,
                recording_path: row.get(19)?,
                self_report_valence: row.get(20)?,
                self_report_arousal: row.get(21)?,
                self_report_dominance: row.get(22)?,
                quality: row.get(23)?,
                label_source: row.get(24)?,
                artifact_flags: row.get(25)?,
                operator_notes: row.get(26)?,
                created_at: row.get(27)?,
            })
        })
        .map_err(|_| "Failed to load EEG trials.".to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Failed to load EEG trials.".to_string())?
        .into_iter()
        .map(parse_trial_row)
        .collect()
}

/// Summary of an already-persisted session, read back from the database.
pub fn get_paradigm_session_summary(
    conn: &Connection,
    session_id: &str,
) -> Result<ParadigmSessionSummary, String> {
    let records = list_eeg_trials_for_session(conn, session_id)?;
    Ok(summarize_trials(session_id.trim(), &records))
}

fn artifact_flags_json(record: &TrialRecord) -> String {
    serde_json::to_string(&record.artifact_flags).unwrap_or_else(|_| "[]".to_string())
}

struct TrialRow {
    id: String,
    session_id: String,
    study_session: String,
    subject_id: String,
    session_run_id: String,
    trial_index: i64,
    status: String,
    paradigm_emotion: String,
    trigger_class: u8,
    video_id: String,
    video_path: String,
    trigger_start_ts: Option<String>,
    trigger_end_ts: Option<String>,
    eeg_start_ts: String,
    eeg_end_ts: Option<String>,
    eeg_start_sample_index: u64,
    eeg_end_sample_index: Option<u64>,
    sample_rate_hz: u32,
    channel_count: usize,
    recording_path: String,
    self_report_valence: Option<u8>,
    self_report_arousal: Option<u8>,
    self_report_dominance: Option<u8>,
    quality: Option<String>,
    label_source: Option<String>,
    artifact_flags: String,
    operator_notes: Option<String>,
    created_at: String,
}

fn parse_trial_row(row: TrialRow) -> Result<TrialRecord, String> {
    let emotion = ParadigmEmotion::from_db_str(&row.paradigm_emotion)?;
    let suggested = match (row.self_report_valence, row.self_report_arousal) {
        (Some(valence), Some(arousal)) => Some(compute_acceptance(emotion, valence, arousal)),
        _ => None,
    };

    Ok(TrialRecord {
        trial_id: row.id,
        session_id: row.session_id,
        subject_id: row.subject_id,
        session_run_id: row.session_run_id,
        study_session: ParadigmSessionKind::from_db_str(&row.study_session)?,
        trial_index: row.trial_index as u32,
        status: TrialStatus::from_db_str(&row.status)?,
        phase: ParadigmSessionKind::from_db_str(&row.study_session)?.as_str().to_string(),
        paradigm_emotion: emotion,
        system_emotion: None,
        trigger_class: row.trigger_class,
        video_id: row.video_id,
        video_path: row.video_path,
        trigger_start_ts: row.trigger_start_ts,
        trigger_end_ts: row.trigger_end_ts,
        eeg_start_ts: row.eeg_start_ts,
        eeg_end_ts: row.eeg_end_ts,
        eeg_start_sample_index: row.eeg_start_sample_index,
        eeg_end_sample_index: row.eeg_end_sample_index,
        sample_rate_hz: row.sample_rate_hz,
        channel_count: row.channel_count,
        recording_path: row.recording_path,
        self_report_valence: row.self_report_valence,
        self_report_arousal: row.self_report_arousal,
        self_report_dominance: row.self_report_dominance,
        self_report_acceptance: suggested,
        quality: row
            .quality
            .map(|quality| TrialQuality::from_db_str(&quality))
            .transpose()?,
        label_source: row
            .label_source
            .map(|source| LabelSource::from_db_str(&source))
            .transpose()?,
        artifact_flags: serde_json::from_str::<Vec<String>>(&row.artifact_flags)
            .unwrap_or_default(),
        operator_notes: row.operator_notes,
        created_at: row.created_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use crate::eeg::paradigm::{
        BeginEegTrialInput, FinalizeEegTrialInput, ParadigmInfo, SelfReportInput, TrialMarkKind,
    };
    use crate::eeg::paradigm_controller::ParadigmController;
    use crate::eeg::session::{EegRecordingSession, StartEegRecordingInput};
    use crate::eeg::storage::{
        self, insert_eeg_session, RecordingMessage, RecordingWorker, RecordingWriter,
    };
    use crate::eeg::{protocol::EEG_CHANNEL_COUNT, EegStreamConfig};
    use std::{
        fs,
        path::{Path, PathBuf},
        thread,
        time::{SystemTime, UNIX_EPOCH},
    };

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
        storage::init_eeg_session_schema(&conn).expect("init eeg session schema");
        init_eeg_trial_schema(&conn).expect("init eeg trial schema");
        conn
    }

    fn temp_recording_dir() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("tauri-eeg-paradigm-db-{suffix}"))
    }

    fn paradigm_info() -> ParadigmInfo {
        ParadigmInfo {
            study_session: ParadigmSessionKind::PersonalCalibration,
            subject_id: "subject-1".to_string(),
            session_run_id: "run-2026-08-23".to_string(),
        }
    }

    fn send_sample(worker: &RecordingWorker, trigger: i32) {
        worker
            .sender()
            .send(RecordingMessage::Sample {
                samples: [0.0_f32; EEG_CHANNEL_COUNT],
                trigger,
            })
            .expect("send sample");
    }

    fn wait_for_sample_count(worker: &RecordingWorker, target: u64) {
        while worker.session().sample_count < target {
            thread::sleep(std::time::Duration::from_millis(1));
        }
    }

    fn wait_for_observations(worker: &RecordingWorker, target: usize) {
        while worker.trigger_observations().len() < target {
            thread::sleep(std::time::Duration::from_millis(1));
        }
    }

    #[test]
    fn creates_eeg_trials_schema_with_session_index() {
        let conn = setup_conn();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'eeg_trials'",
                [],
                |row| row.get(0),
            )
            .expect("query schema");
        let index_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_eeg_trials_session'",
                [],
                |row| row.get(0),
            )
            .expect("query index");

        assert_eq!(count, 1);
        assert_eq!(index_count, 1);
    }

    #[test]
    fn paradigm_recording_lifecycle_persists_files_rows_and_manifest() {
        let conn = setup_conn();
        let base_dir = temp_recording_dir();
        let writer = RecordingWriter::start(
            &conn,
            &base_dir,
            StartEegRecordingInput {
                user_id: "user-1".to_string(),
                username: "alice".to_string(),
                paradigm: Some(paradigm_info()),
            },
            &EegStreamConfig::default(),
        )
        .expect("start writer");
        let session = writer.session();
        let worker = RecordingWorker::start(writer);
        let mut controller = ParadigmController::new(
            paradigm_info(),
            session.id.clone(),
            session.session_dir.clone(),
            session.sample_rate_hz,
            session.channel_count,
            worker.sender(),
            worker.sample_count_handle(),
            worker.trigger_observations_handle(),
        );
        controller.emit_session_started();

        // Completed trial with matching hardware triggers.
        controller
            .begin(BeginEegTrialInput {
                trial_index: 0,
                emotion: ParadigmEmotion::Depression,
                video_id: "depression_vid00".to_string(),
                video_path: "X:/videos/Depression/depression_vid00.mp4".to_string(),
            })
            .expect("begin trial");
        send_sample(&worker, 0);
        send_sample(&worker, 1);
        wait_for_sample_count(&worker, 2);
        wait_for_observations(&worker, 1);
        controller.mark(TrialMarkKind::PreVideoHint).expect("mark");
        send_sample(&worker, 255);
        wait_for_sample_count(&worker, 3);
        wait_for_observations(&worker, 2);

        let ended = controller.end().expect("end trial");
        assert_eq!(ended.eeg_end_sample_index, Some(3));
        assert_eq!(ended.hardware_triggers.len(), 2);
        assert_eq!(ended.hardware_triggers[0].code, 1);
        assert_eq!(ended.hardware_triggers[0].sample_index, 1);
        assert_eq!(ended.hardware_triggers[1].code, 255);
        assert!(ended.trigger_start_ts.is_some());
        assert!(ended.trigger_end_ts.is_some());

        let record = controller
            .finalize(FinalizeEegTrialInput {
                self_report: Some(SelfReportInput {
                    valence: 3,
                    arousal: 3,
                    dominance: Some(2),
                }),
                quality: None,
                artifact_flags: Vec::new(),
                operator_notes: Some("clean trial".to_string()),
                label_source: None,
            })
            .expect("finalize trial");
        assert_eq!(record.trial_id, "run-2026-08-23_t01");
        assert_eq!(record.status, TrialStatus::Completed);
        assert_eq!(record.self_report_acceptance, Some(TrialQuality::Accepted));
        assert_eq!(record.quality, Some(TrialQuality::Accepted));
        assert_eq!(record.label_source, Some(LabelSource::SelfReportConfirmed));

        // Second trial is still active when the session stops.
        controller
            .begin(BeginEegTrialInput {
                trial_index: 1,
                emotion: ParadigmEmotion::Calm,
                video_id: "calm_vid00".to_string(),
                video_path: "X:/videos/Calm/calm_vid00.mp4".to_string(),
            })
            .expect("begin second trial");
        let interrupted = controller.interrupt().expect("interrupt trial");
        assert_eq!(interrupted.status, TrialStatus::Interrupted);
        assert_eq!(interrupted.quality, None);
        assert_eq!(interrupted.trial_id, "run-2026-08-23_t02");

        let records = controller.take_all();
        assert_eq!(records.len(), 2);
        let summary = summarize_trials(&session.id, &records);
        assert_eq!(summary.total_trials, 2);
        let manifest = serde_json::to_string_pretty(&summary).expect("serialize manifest");
        worker
            .sender()
            .send(RecordingMessage::Manifest(manifest))
            .expect("send manifest");
        drop(controller);

        let session: EegRecordingSession = worker.stop().expect("stop worker");
        insert_eeg_session(&conn, &session).expect("insert session row");
        for record in &records {
            insert_eeg_trial(&conn, record, &session.user_id).expect("insert trial row");
        }

        // Session directory carries all paradigm artifacts.
        let dir = Path::new(&session.session_dir);
        for name in [
            "eeg.f32le.bin",
            "trigger.i32le.bin",
            "metadata.json",
            "trial-events.jsonl",
            "trials.jsonl",
            "training-manifest.json",
        ] {
            assert!(dir.join(name).is_file(), "missing {name}");
        }

        let metadata: Value = serde_json::from_str(
            &fs::read_to_string(dir.join("metadata.json")).expect("read metadata"),
        )
        .expect("parse metadata");
        assert_eq!(metadata["paradigm"]["studySession"], "personal_calibration");
        assert_eq!(metadata["paradigm"]["subjectId"], "subject-1");
        assert_eq!(metadata["paradigm"]["sessionRunId"], "run-2026-08-23");

        let events: Vec<Value> = fs::read_to_string(dir.join("trial-events.jsonl"))
            .expect("read trial events")
            .lines()
            .map(|line| serde_json::from_str(line).expect("parse event"))
            .collect();
        let event_types: Vec<&str> = events
            .iter()
            .map(|event| event["type"].as_str().expect("type"))
            .collect();
        for expected in [
            "session_started",
            "trial_started",
            "mark",
            "hardware_trigger",
            "trial_ended",
            "trial_finalized",
            "trial_interrupted",
        ] {
            assert!(event_types.contains(&expected), "missing {expected}");
        }
        assert_eq!(events[0]["sessionRunId"], "run-2026-08-23");
        assert_eq!(events[1]["emotion"], "depression");
        assert_eq!(events[1]["triggerClass"], 1);

        let trials: Vec<Value> = fs::read_to_string(dir.join("trials.jsonl"))
            .expect("read trials")
            .lines()
            .map(|line| serde_json::from_str(line).expect("parse trial"))
            .collect();
        assert_eq!(trials.len(), 2);
        assert_eq!(trials[0]["trialId"], "run-2026-08-23_t01");
        assert_eq!(trials[0]["selfReportValence"], 3);

        let manifest: Value = serde_json::from_str(
            &fs::read_to_string(dir.join("training-manifest.json")).expect("read manifest"),
        )
        .expect("parse manifest");
        assert_eq!(manifest["totalTrials"], 2);
        assert_eq!(manifest["sessionId"], session.id);

        // Database rows round-trip, including the interrupted trial.
        let stored = list_eeg_trials_for_session(&conn, &session.id).expect("list trials");
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0], records[0]);
        assert_eq!(stored[1], records[1]);
        assert_eq!(stored[1].status, TrialStatus::Interrupted);
        assert_eq!(stored[1].quality, None);

        let summary = get_paradigm_session_summary(&conn, &session.id).expect("summary");
        assert_eq!(summary.total_trials, 2);
        let depression = summary
            .per_class
            .iter()
            .find(|class| class.emotion == ParadigmEmotion::Depression)
            .expect("depression class");
        assert_eq!(depression.accepted, 1);
        let calm = summary
            .per_class
            .iter()
            .find(|class| class.emotion == ParadigmEmotion::Calm)
            .expect("calm class");
        assert_eq!(calm.interrupted, 1);

        // Trial rows cannot exist without their session row (FK enforced).
        let mut orphan = stored[0].clone();
        orphan.trial_id = "run-2026-08-23_t99".to_string();
        orphan.session_id = "missing-session".to_string();
        assert!(insert_eeg_trial(&conn, &orphan, "user-1").is_err());
        let mut orphan_user = stored[0].clone();
        orphan_user.trial_id = "run-2026-08-23_t98".to_string();
        assert!(insert_eeg_trial(&conn, &orphan_user, "missing-user").is_err());

        let _ = fs::remove_dir_all(base_dir);
    }

    #[test]
    fn non_paradigm_sessions_do_not_create_paradigm_files() {
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
        send_sample(&worker, 0);
        wait_for_sample_count(&worker, 1);

        let session = worker.stop().expect("stop worker");
        let dir = Path::new(&session.session_dir);
        assert!(!dir.join("trial-events.jsonl").exists());
        assert!(!dir.join("trials.jsonl").exists());
        assert!(!dir.join("training-manifest.json").exists());
        let metadata: Value = serde_json::from_str(
            &fs::read_to_string(dir.join("metadata.json")).expect("read metadata"),
        )
        .expect("parse metadata");
        assert_eq!(metadata["paradigm"], Value::Null);
        assert!(list_eeg_trials_for_session(&conn, &session.id)
            .expect("list trials")
            .is_empty());

        let _ = fs::remove_dir_all(base_dir);
    }

    #[test]
    fn trigger_observations_record_correct_sample_index() {
        let conn = setup_conn();
        let base_dir = temp_recording_dir();
        let writer = RecordingWriter::start(
            &conn,
            &base_dir,
            StartEegRecordingInput {
                user_id: "user-1".to_string(),
                username: "alice".to_string(),
                paradigm: Some(paradigm_info()),
            },
            &EegStreamConfig::default(),
        )
        .expect("start writer");
        let worker = RecordingWorker::start(writer);

        send_sample(&worker, 0);
        send_sample(&worker, 5);
        send_sample(&worker, 0);
        send_sample(&worker, 255);
        wait_for_sample_count(&worker, 4);
        wait_for_observations(&worker, 2);

        let observations = worker.trigger_observations();
        assert_eq!(observations.len(), 2);
        assert_eq!(observations[0].code, 5);
        assert_eq!(observations[0].sample_index, 1);
        assert_eq!(observations[1].code, 255);
        assert_eq!(observations[1].sample_index, 3);
        assert!(!observations[0].timestamp.is_empty());

        let _ = worker.stop().expect("stop worker");
        let _ = fs::remove_dir_all(base_dir);
    }
}
