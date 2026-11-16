//! Integration-style unit tests for the scale_records module, kept out of
//! the per-domain files so each stays reviewable on its own.

use super::*;
use rusqlite::{params, Connection};
use serde_json::json;
use std::collections::BTreeMap;

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
    init_scale_records_schema(&conn).expect("init scale records schema");
    conn.execute(
        "CREATE TABLE IF NOT EXISTS experiment_scales (
            record_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            measurement_time TEXT NOT NULL
        )",
        [],
    )
    .expect("create experiment_scales table");
    conn
}

fn sample_input(user_id: &str, subject_id: Option<&str>, phase: &str) -> SaveScaleRecordInput {
    SaveScaleRecordInput {
        user_id: user_id.to_string(),
        subject_id: subject_id.map(str::to_string),
        scale_id: "/video-regulation".to_string(),
        phase: phase.to_string(),
        dimension_scores: BTreeMap::from([
            ("anxiety".to_string(), 75.0),
            ("mood".to_string(), 50.0),
        ]),
        raw_answers: json!({ "video-anxiety-tense": 2 }),
        emotion: Some("anxiety".to_string()),
        condition: None,
        duration_minutes: Some(5),
        regulation_skipped: false,
        measured_dimensions: None,
        experiment_run_id: None,
    }
}

#[test]
fn saves_and_lists_scale_records_chronologically() {
    let conn = setup_conn();

    let saved_baseline = save_scale_record(
        &conn,
        &sample_input("user-1", Some("subject-1"), PHASE_BASELINE),
    )
    .expect("save baseline");
    let saved_post = save_scale_record(
        &conn,
        &sample_input("user-1", Some("subject-1"), PHASE_POST),
    )
    .expect("save post");

    assert_eq!(saved_baseline.phase, PHASE_BASELINE);
    assert_eq!(saved_baseline.user_id, "user-1");
    assert_eq!(saved_baseline.scale_id, "/video-regulation");
    assert_eq!(
        saved_baseline.dimension_scores,
        json!({ "anxiety": 75.0, "mood": 50.0 })
    );
    assert_eq!(
        saved_baseline
            .raw_answers
            .value()
            .expect("parse saved raw answers")["video-anxiety-tense"],
        2
    );
    assert!(!saved_baseline.id.is_empty());
    assert!(!saved_baseline.created_at.is_empty());

    // Pin distinct timestamps: ORDER BY created_at must then return the
    // baseline before the post regardless of clock resolution.
    conn.execute(
        "UPDATE scale_records SET created_at = ?1 WHERE id = ?2",
        params!["2026-08-01T10:00:00+00:00", saved_baseline.id],
    )
    .expect("stamp baseline");
    conn.execute(
        "UPDATE scale_records SET created_at = ?1 WHERE id = ?2",
        params!["2026-08-01T11:00:00+00:00", saved_post.id],
    )
    .expect("stamp post");

    let records = list_scale_records(&conn, Some("subject-1"), None).expect("list records");
    assert_eq!(records.len(), 2);
    assert_eq!(records[0].id, saved_baseline.id);
    assert_eq!(records[1].id, saved_post.id);
    assert_eq!(records[0].phase, PHASE_BASELINE);
    assert_eq!(records[1].phase, PHASE_POST);
}

#[test]
fn list_query_builder_binds_one_concrete_clause_per_filter() {
    // Unfiltered: no WHERE clause, chronological order preserved.
    let (sql, bindings) = build_list_records_sql(None, None);
    assert!(bindings.is_empty());
    assert!(!sql.contains("WHERE"));
    assert!(sql.ends_with("ORDER BY created_at ASC"));

    // Subject only: a single concrete equality that the planner can serve
    // from the subject+created_at index.
    let (sql, bindings) = build_list_records_sql(Some("subject-1"), None);
    assert_eq!(bindings, vec!["subject-1".to_string()]);
    assert!(sql.contains("WHERE subject_id = ?"));
    assert!(!sql.contains("IS NULL"));
    assert!(sql.ends_with("ORDER BY created_at ASC"));

    // Phase only.
    let (sql, bindings) = build_list_records_sql(None, Some(PHASE_POST));
    assert_eq!(bindings, vec![PHASE_POST.to_string()]);
    assert!(sql.contains("WHERE phase = ?"));

    // Both filters: AND-joined, subject bound first (clause order matches
    // the binding order so positional placeholders line up).
    let (sql, bindings) = build_list_records_sql(Some("subject-1"), Some(PHASE_POST));
    assert_eq!(
        bindings,
        vec!["subject-1".to_string(), PHASE_POST.to_string()]
    );
    assert!(sql.contains("WHERE subject_id = ? AND phase = ?"));
}

#[test]
fn init_creates_the_subject_created_index() {
    let conn = setup_conn();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
                    WHERE type = 'index' AND name = 'idx_scale_records_subject_created'",
            [],
            |row| row.get(0),
        )
        .expect("query sqlite schema");

    assert_eq!(count, 1);
}

#[test]
fn trims_and_rejects_blank_fields() {
    let conn = setup_conn();

    let mut input = sample_input("  ", Some("subject-1"), PHASE_BASELINE);
    assert_eq!(
        save_scale_record(&conn, &input).unwrap_err(),
        "User id is required."
    );

    input.user_id = "user-1".to_string();
    input.scale_id = "  ".to_string();
    assert_eq!(
        save_scale_record(&conn, &input).unwrap_err(),
        "Scale id is required."
    );

    input.scale_id = "/video-regulation".to_string();
    input.phase = "mid".to_string();
    assert_eq!(
        save_scale_record(&conn, &input).unwrap_err(),
        "Scale record phase must be 'pre_induction', 'baseline' or 'post'."
    );
}

#[test]
fn blank_subject_id_is_stored_as_null() {
    let conn = setup_conn();

    let saved = save_scale_record(&conn, &sample_input("user-1", Some("   "), PHASE_BASELINE))
        .expect("save record");

    assert_eq!(saved.subject_id, None);
}

#[test]
fn lists_scale_records_with_combined_filters() {
    let conn = setup_conn();
    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at, updated_at)
                VALUES ('user-2', 'bob', 'hash', 'now', 'now')",
        [],
    )
    .expect("insert second user");

    save_scale_record(
        &conn,
        &sample_input("user-1", Some("subject-1"), PHASE_BASELINE),
    )
    .expect("save baseline s1");
    save_scale_record(
        &conn,
        &sample_input("user-1", Some("subject-1"), PHASE_POST),
    )
    .expect("save post s1");
    save_scale_record(
        &conn,
        &sample_input("user-2", Some("subject-2"), PHASE_BASELINE),
    )
    .expect("save baseline s2");

    let by_subject = list_scale_records(&conn, Some("subject-2"), None).expect("filter subject");
    assert_eq!(by_subject.len(), 1);
    assert_eq!(by_subject[0].phase, PHASE_BASELINE);

    let by_phase = list_scale_records(&conn, None, Some(PHASE_POST)).expect("filter phase");
    assert_eq!(by_phase.len(), 1);
    assert_eq!(by_phase[0].subject_id.as_deref(), Some("subject-1"));

    let both =
        list_scale_records(&conn, Some("subject-1"), Some(PHASE_BASELINE)).expect("filter both");
    assert_eq!(both.len(), 1);

    let all = list_scale_records(&conn, None, None).expect("no filter");
    assert_eq!(all.len(), 3);

    assert_eq!(
        list_scale_records(&conn, Some("missing"), None)
            .expect("list missing")
            .len(),
        0
    );
}

#[test]
fn deletes_scale_record_by_id_only() {
    let conn = setup_conn();
    let saved = save_scale_record(
        &conn,
        &sample_input("user-1", Some("subject-1"), PHASE_BASELINE),
    )
    .expect("save record");

    conn.execute(
        "INSERT INTO experiment_scales (record_id, run_id, measurement_time) VALUES (?1, 'run-1', 'baseline')",
        params![saved.id],
    )
    .expect("insert experiment scale link");

    let deleted = delete_scale_record(&conn, &saved.id).expect("delete record");
    assert_eq!(deleted.id, saved.id);
    assert!(list_scale_records(&conn, None, None)
        .expect("list records")
        .is_empty());

    let remaining_links: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM experiment_scales WHERE record_id = ?1",
            params![saved.id],
            |row| row.get(0),
        )
        .expect("count remaining links");
    assert_eq!(remaining_links, 0);

    assert_eq!(
        delete_scale_record(&conn, &saved.id).unwrap_err(),
        "Scale record not found."
    );
}

#[test]
fn gets_scale_record_by_id_and_rejects_missing_rows() {
    let conn = setup_conn();
    let saved = save_scale_record(
        &conn,
        &sample_input("user-1", Some("subject-1"), PHASE_POST),
    )
    .expect("save record");

    let loaded = get_scale_record(&conn, &saved.id).expect("get record");
    assert_eq!(loaded.id, saved.id);
    assert_eq!(loaded.phase, PHASE_POST);
    assert_eq!(loaded.subject_id.as_deref(), Some("subject-1"));
    assert_eq!(
        loaded.dimension_scores,
        json!({ "anxiety": 75.0, "mood": 50.0 })
    );

    assert_eq!(
        get_scale_record(&conn, "missing-id").unwrap_err(),
        "Scale record not found."
    );
}

#[test]
fn enforces_user_foreign_key() {
    let conn = setup_conn();

    assert_eq!(
        save_scale_record(&conn, &sample_input("missing-user", None, PHASE_BASELINE)).unwrap_err(),
        "Failed to save scale record."
    );
}

#[test]
fn persists_measured_dimensions() {
    let conn = setup_conn();

    let mut input = sample_input("user-1", Some("subject-1"), PHASE_POST);
    input.measured_dimensions = Some(vec![
        " mood ".to_string(),
        "anxiety".to_string(),
        "mood".to_string(),
        "   ".to_string(),
    ]);

    let saved = save_scale_record(&conn, &input).expect("save record");

    // Trimmed, deduplicated, blanks dropped, order preserved.
    assert_eq!(
        saved.measured_dimensions.as_deref(),
        Some(&["mood".to_string(), "anxiety".to_string()][..])
    );

    let loaded = get_scale_record(&conn, &saved.id).expect("reload record");
    assert_eq!(
        loaded.measured_dimensions,
        Some(vec!["mood".to_string(), "anxiety".to_string()])
    );

    let listed = list_scale_records(&conn, None, None).expect("list records");
    assert_eq!(listed.len(), 1);
}

#[test]
fn normalizes_empty_marker_lists() {
    let conn = setup_conn();

    let mut blank_markers = sample_input("user-1", None, PHASE_BASELINE);
    blank_markers.measured_dimensions = Some(vec!["   ".to_string()]);
    let saved = save_scale_record(&conn, &blank_markers).expect("save record");

    // An all-blank marker list still counts as explicitly empty (it must
    // not degrade to the unmarked legacy fallback), while a blank session
    // id is stored as NULL like other optional text.
    assert_eq!(saved.measured_dimensions, Some(Vec::new()));
}

#[test]
fn migration_adds_missing_columns_to_a_legacy_table() {
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

    // Pre-R3 shape: none of the new columns exist yet, with one row saved
    // under the legacy schema.
    conn.execute_batch(
            "CREATE TABLE scale_records (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                subject_id TEXT,
                scale_id TEXT NOT NULL,
                phase TEXT NOT NULL,
                dimension_scores TEXT NOT NULL DEFAULT '{}',
                raw_answers TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            INSERT INTO scale_records (id, user_id, subject_id, scale_id, phase, dimension_scores, raw_answers, created_at)
                VALUES ('legacy-1', 'user-1', 'subject-old', '/video-regulation', 'post', '{}', '{}', '2026-07-01T00:00:00+00:00');",
        )
        .expect("create legacy table");

    init_scale_records_schema(&conn).expect("migrate schema");

    let loaded = get_scale_record(&conn, "legacy-1").expect("load legacy row");
    assert_eq!(loaded.emotion, None);
    // R6: pre-R6 rows carry no condition and read back as legacy (NULL).
    assert_eq!(loaded.condition, None);
    assert_eq!(loaded.duration_minutes, None);
    assert!(!loaded.regulation_skipped);
    // R4 columns degrade to the legacy semantics on pre-R4 rows.
    assert_eq!(loaded.measured_dimensions, None);

    // The migrated table keeps accepting full saves.
    let mut saved_input = sample_input("user-1", Some("subject-new"), PHASE_BASELINE);
    saved_input.measured_dimensions = Some(vec!["anxiety".to_string()]);
    let saved = save_scale_record(&conn, &saved_input).expect("save after migration");
    assert_eq!(saved.emotion.as_deref(), Some("anxiety"));
    assert_eq!(
        saved.measured_dimensions.as_deref(),
        Some(&["anxiety".to_string()][..])
    );
}

#[test]
fn persists_condition_and_rejects_unknown_values() {
    let conn = setup_conn();

    let mut input = sample_input("user-1", Some("subject-1"), PHASE_POST);
    input.condition = Some(" natural_recovery ".to_string());

    let saved = save_scale_record(&conn, &input).expect("save record");
    assert_eq!(saved.condition.as_deref(), Some(CONDITION_NATURAL_RECOVERY));

    let loaded = get_scale_record(&conn, &saved.id).expect("reload record");
    assert_eq!(
        loaded.condition.as_deref(),
        Some(CONDITION_NATURAL_RECOVERY)
    );

    let listed = list_scale_records(&conn, None, None).expect("list records");
    assert_eq!(
        listed[0].condition.as_deref(),
        Some(CONDITION_NATURAL_RECOVERY)
    );

    // A blank condition stays NULL like other optional text (legacy shape).
    let mut blank = sample_input("user-1", Some("subject-1"), PHASE_POST);
    blank.condition = Some("   ".to_string());
    let saved_blank = save_scale_record(&conn, &blank).expect("save blank condition");
    assert_eq!(saved_blank.condition, None);

    // Direct API callers cannot smuggle in arbitrary condition values.
    let mut unknown = sample_input("user-1", Some("subject-1"), PHASE_POST);
    unknown.condition = Some("hypnosis".to_string());
    assert_eq!(
        save_scale_record(&conn, &unknown).unwrap_err(),
        "Scale record condition must be 'natural_recovery' or 'regulation'."
    );
}

#[test]
fn persists_emotion_duration_and_skip_flags() {
    let conn = setup_conn();

    let mut input = sample_input("user-1", Some(" subject-1 "), PHASE_POST);
    input.emotion = Some("  fear  ".to_string());
    input.duration_minutes = Some(10);
    input.regulation_skipped = true;

    let saved = save_scale_record(&conn, &input).expect("save record");
    assert_eq!(saved.emotion.as_deref(), Some("fear"));
    assert_eq!(saved.duration_minutes, Some(10));
    assert!(saved.regulation_skipped);

    let loaded = get_scale_record(&conn, &saved.id).expect("reload record");
    assert_eq!(loaded.emotion.as_deref(), Some("fear"));
    assert_eq!(loaded.duration_minutes, Some(10));
    assert!(loaded.regulation_skipped);

    let listed = list_scale_records(&conn, None, None).expect("list records");
    assert_eq!(listed.len(), 1);
    assert!(listed[0].regulation_skipped);
}

#[test]
fn normalizes_blank_emotion_and_non_positive_durations() {
    let conn = setup_conn();

    let mut input = sample_input("user-1", None, PHASE_BASELINE);
    input.emotion = Some("   ".to_string());
    input.duration_minutes = Some(0);

    let saved = save_scale_record(&conn, &input).expect("save record");
    assert_eq!(saved.emotion, None);
    assert_eq!(saved.duration_minutes, None);
}
