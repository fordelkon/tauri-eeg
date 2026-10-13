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
        "Scale record phase must be 'baseline' or 'post'."
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

fn persisted_pair(
    conn: &Connection,
    baseline_scores: serde_json::Value,
    post_scores: serde_json::Value,
) -> (ScaleRecord, ScaleRecord) {
    let mut baseline = save_scale_record(
        conn,
        &sample_input("user-1", Some("subject-1"), PHASE_BASELINE),
    )
    .expect("save baseline");
    baseline.dimension_scores = baseline_scores;
    let mut post = save_scale_record(conn, &sample_input("user-1", Some("subject-1"), PHASE_POST))
        .expect("save post");
    post.dimension_scores = post_scores;
    (baseline, post)
}

#[test]
fn computes_per_dimension_improvement_rates_and_mean() {
    let conn = setup_conn();
    let (baseline, post) = persisted_pair(
        &conn,
        json!({ "anxiety": 80.0, "mood": 50.0 }),
        json!({ "anxiety": 48.0, "mood": 25.0 }),
    );

    let summary = compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

    assert_eq!(summary.dimensions.len(), 2);
    let anxiety = &summary.dimensions[0];
    assert_eq!(anxiety.dimension, "anxiety");
    assert_eq!(anxiety.baseline, 80.0);
    assert_eq!(anxiety.post, 48.0);
    assert_eq!(anxiety.improvement_rate, 0.4);
    assert_eq!(summary.dimensions[1].improvement_rate, 0.5);

    let mean = summary.mean_improvement_rate.expect("mean present");
    assert!((mean - 0.45).abs() < 1e-9);
    assert!(summary.meets_threshold());
    assert!(!summary.meets_threshold_at(0.5));
}

#[test]
fn skips_dimensions_missing_on_either_side() {
    let conn = setup_conn();
    let (baseline, post) = persisted_pair(
        &conn,
        json!({ "anxiety": 80.0, "mood": 50.0, "energy": 40.0 }),
        json!({ "anxiety": 48.0 }),
    );

    let summary = compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

    // Only anxiety appears on both sides; mood/energy are dropped.
    assert_eq!(summary.dimensions.len(), 1);
    assert_eq!(summary.dimensions[0].dimension, "anxiety");
}

#[test]
fn skips_zero_baseline_dimensions_instead_of_dividing_by_zero() {
    let conn = setup_conn();
    let (baseline, post) = persisted_pair(
        &conn,
        json!({ "anxiety": 0.0, "mood": 50.0 }),
        json!({ "anxiety": 30.0, "mood": 45.0 }),
    );

    let summary = compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

    assert_eq!(summary.dimensions.len(), 1);
    assert_eq!(summary.dimensions[0].dimension, "mood");
    assert_eq!(summary.dimensions[0].improvement_rate, 0.1);
}

#[test]
fn reports_no_mean_when_no_dimension_is_comparable() {
    let conn = setup_conn();
    let (baseline, post) =
        persisted_pair(&conn, json!({ "anxiety": 0.0 }), json!({ "mood": 30.0 }));

    let summary = compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

    assert!(summary.dimensions.is_empty());
    assert_eq!(summary.mean_improvement_rate, None);
    assert!(!summary.meets_threshold());
}

#[test]
fn allows_negative_improvement_when_state_worsens() {
    let conn = setup_conn();
    let (baseline, post) = persisted_pair(&conn, json!({ "mood": 40.0 }), json!({ "mood": 60.0 }));

    let summary = compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

    assert_eq!(summary.dimensions[0].improvement_rate, -0.5);
    assert!(!summary.meets_threshold());
}

#[test]
fn rejects_swapped_or_wrong_phases() {
    let conn = setup_conn();
    let (baseline, post) = persisted_pair(&conn, json!({ "mood": 40.0 }), json!({ "mood": 30.0 }));

    assert!(compute_regulation_effect_summary(&post, &baseline).is_err());
    assert!(compute_regulation_effect_summary(&baseline, &baseline).is_err());
}

#[test]
fn rejects_records_from_different_subjects_but_allows_unknown() {
    let conn = setup_conn();
    let mut baseline = save_scale_record(
        &conn,
        &sample_input("user-1", Some("subject-1"), PHASE_BASELINE),
    )
    .expect("save baseline");
    let mut other_subject = save_scale_record(
        &conn,
        &sample_input("user-1", Some("subject-2"), PHASE_POST),
    )
    .expect("save post");
    let mut anonymous = save_scale_record(&conn, &sample_input("user-1", None, PHASE_POST))
        .expect("save anonymous post");

    assert_eq!(
        compute_regulation_effect_summary(&baseline, &other_subject).unwrap_err(),
        "Baseline and post records belong to different subjects."
    );

    baseline.subject_id = None;
    other_subject.subject_id = None;
    anonymous.subject_id = None;
    assert!(compute_regulation_effect_summary(&baseline, &anonymous).is_ok());
}

#[test]
fn threshold_boundary_includes_the_threshold_itself() {
    let conn = setup_conn();
    let (baseline, post) = persisted_pair(&conn, json!({ "mood": 10.0 }), json!({ "mood": 9.0 }));

    let summary = compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

    assert_eq!(
        summary.dimensions[0].improvement_rate,
        DEFAULT_IMPROVEMENT_THRESHOLD
    );
    assert!(summary.meets_threshold());
}

/* ---------------- R4: measured-dimension markers + EEG session id ---------------- */

/// Saves a pair whose score maps are overridden after the insert (same
/// trick as `persisted_pair`) while carrying explicit marker lists.
fn marked_pair(
    conn: &Connection,
    baseline_scores: serde_json::Value,
    baseline_markers: Option<Vec<&str>>,
    post_scores: serde_json::Value,
    post_markers: Option<Vec<&str>>,
) -> (ScaleRecord, ScaleRecord) {
    let mut baseline = save_scale_record(
        conn,
        &SaveScaleRecordInput {
            measured_dimensions: baseline_markers
                .map(|keys| keys.iter().map(|key| key.to_string()).collect()),
            ..sample_input("user-1", Some("subject-1"), PHASE_BASELINE)
        },
    )
    .expect("save baseline");
    baseline.dimension_scores = baseline_scores;

    let mut post = save_scale_record(
        conn,
        &SaveScaleRecordInput {
            measured_dimensions: post_markers
                .map(|keys| keys.iter().map(|key| key.to_string()).collect()),
            ..sample_input("user-1", Some("subject-1"), PHASE_POST)
        },
    )
    .expect("save post");
    post.dimension_scores = post_scores;

    (baseline, post)
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
fn measured_markers_exclude_placeholder_dimensions_from_the_mean() {
    let conn = setup_conn();
    // Both sides store the full legacy four-key shape including the
    // never-measured `worry` placeholder at 50/50...
    let (baseline, post) = marked_pair(
        &conn,
        json!({ "anxiety": 80.0, "worry": 50.0, "mood": 60.0 }),
        Some(vec!["anxiety", "mood"]),
        json!({ "anxiety": 48.0, "worry": 50.0, "mood": 30.0 }),
        Some(vec!["anxiety", "mood"]),
    );

    let summary = compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

    // ...but only the marked dimensions enter the comparison.
    assert!(summary.measured_only);
    let compared: Vec<&str> = summary
        .dimensions
        .iter()
        .map(|item| item.dimension.as_str())
        .collect();
    assert_eq!(compared, vec!["anxiety", "mood"]);
    let mean = summary.mean_improvement_rate.expect("mean present");
    assert!((mean - 0.45).abs() < 1e-9);
}

#[test]
fn markers_override_stored_keys_in_both_directions() {
    let conn = setup_conn();

    // A stored key without a marker is dropped even though scores exist…
    let (baseline, post) = marked_pair(
        &conn,
        json!({ "anxiety": 80.0, "energy": 40.0 }),
        Some(vec!["anxiety"]),
        json!({ "anxiety": 48.0, "energy": 20.0 }),
        Some(vec!["anxiety"]),
    );
    let summary = compute_regulation_effect_summary(&baseline, &post).expect("compute summary");
    assert_eq!(summary.dimensions.len(), 1);
    assert_eq!(summary.dimensions[0].dimension, "anxiety");

    // …and a marked key missing from the stored scores is skipped by the
    // regular missing-on-one-side rule instead of panicking.
    let (baseline, post) = marked_pair(
        &conn,
        json!({ "anxiety": 80.0 }),
        Some(vec!["anxiety", "mood"]),
        json!({ "anxiety": 48.0, "mood": 30.0 }),
        Some(vec!["anxiety", "mood"]),
    );
    let summary = compute_regulation_effect_summary(&baseline, &post).expect("compute summary");
    let compared: Vec<&str> = summary
        .dimensions
        .iter()
        .map(|item| item.dimension.as_str())
        .collect();
    assert_eq!(compared, vec!["anxiety"]);
}

#[test]
fn legacy_pairs_without_markers_keep_the_stored_key_comparison() {
    let conn = setup_conn();

    // Pre-R4 rows carry no markers: the historical behavior applies and is
    // reported through measured_only=false so UIs can flag the basis.
    let (baseline, post) = marked_pair(
        &conn,
        json!({ "anxiety": 80.0, "worry": 50.0 }),
        None,
        json!({ "anxiety": 48.0, "worry": 50.0 }),
        None,
    );

    let summary = compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

    assert!(!summary.measured_only);
    assert_eq!(summary.dimensions.len(), 2);
}

#[test]
fn mixed_marker_availability_falls_back_to_stored_keys() {
    let conn = setup_conn();
    let (baseline, post) = marked_pair(
        &conn,
        json!({ "anxiety": 80.0, "mood": 60.0 }),
        Some(vec!["anxiety"]),
        json!({ "anxiety": 48.0, "mood": 30.0 }),
        None,
    );

    let summary = compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

    // One unmarked side means the marker intersection would silently drop
    // data; fall back to every shared stored key instead.
    assert!(!summary.measured_only);
    assert_eq!(summary.dimensions.len(), 2);
}

#[test]
fn effect_history_and_single_report_carry_measured_basis() {
    let conn = setup_conn();

    let mut baseline = sample_input("user-1", Some("subj-link"), PHASE_BASELINE);
    baseline.dimension_scores = BTreeMap::from([("anxiety".to_string(), 80.0)]);
    baseline.measured_dimensions = Some(vec!["anxiety".to_string()]);

    let mut post = sample_input("user-1", Some("subj-link"), PHASE_POST);
    post.dimension_scores = BTreeMap::from([("anxiety".to_string(), 48.0)]);
    post.measured_dimensions = Some(vec!["anxiety".to_string()]);

    let baseline = save_scale_record(&conn, &baseline).expect("save baseline");
    let post = save_scale_record(&conn, &post).expect("save post");

    let report = build_single_effect_report(&baseline, &post).expect("build single report");
    assert!(report.measured_only);

    let json = serde_json::to_value(&report).expect("serialize report");
    assert_eq!(json["measuredOnly"], serde_json::Value::Bool(true));

    let history =
        build_effect_history(&list_scale_records(&conn, None, None).expect("list records"));
    assert_eq!(history.len(), 1);
    assert!(history[0].measured_only);

    // The summary itself reports the restricted basis too.
    let summary = compute_regulation_effect_summary(&baseline, &post).expect("compute summary");
    assert!(summary.measured_only);
}

/* ---------------- R3: emotion/duration/skip persistence ---------------- */

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

/* ---------------- R3: history pairing ---------------- */

fn history_record(
    conn: &Connection,
    subject: Option<&str>,
    phase: &str,
    emotion: Option<&str>,
    skipped: bool,
    stamp: &str,
) -> ScaleRecord {
    let mut input = sample_input("user-1", subject, phase);
    input.emotion = emotion.map(str::to_string);
    input.regulation_skipped = skipped;
    let saved = save_scale_record(conn, &input).expect("save history record");

    // Pin the timestamp so the chronological walk is deterministic.
    conn.execute(
        "UPDATE scale_records SET created_at = ?1 WHERE id = ?2",
        params![stamp, saved.id],
    )
    .expect("pin timestamp");
    get_scale_record(conn, &saved.id).expect("reload pinned record")
}

#[test]
fn build_effect_history_pairs_runs_chronologically() {
    let conn = setup_conn();
    let records = vec![
        history_record(
            &conn,
            Some("s1"),
            PHASE_BASELINE,
            Some("anxiety"),
            false,
            "2026-08-01T09:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_POST,
            Some("anxiety"),
            true,
            "2026-08-01T10:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_BASELINE,
            Some("fear"),
            false,
            "2026-08-02T09:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_POST,
            Some("fear"),
            false,
            "2026-08-02T10:00:00+00:00",
        ),
        history_record(
            &conn,
            None,
            PHASE_BASELINE,
            None,
            false,
            "2026-08-04T09:00:00+00:00",
        ),
        history_record(
            &conn,
            None,
            PHASE_POST,
            None,
            false,
            "2026-08-04T10:00:00+00:00",
        ),
    ];

    let entries = build_effect_history(&records);

    // Each subject walks chronologically: post #1 pairs with baseline #1,
    // post #2 with baseline #2. The unbound pair groups under "".
    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0].subject_id, "s1");
    assert_eq!(entries[0].baseline_created_at, "2026-08-01T09:00:00+00:00");
    assert_eq!(entries[0].post_created_at, "2026-08-01T10:00:00+00:00");
    assert_eq!(entries[0].emotion.as_deref(), Some("anxiety"));
    // The skip marker travels with the run's post record.
    assert!(entries[0].regulation_skipped);

    assert_eq!(entries[1].subject_id, "s1");
    assert_eq!(entries[1].baseline_created_at, "2026-08-02T09:00:00+00:00");
    assert_eq!(entries[1].emotion.as_deref(), Some("fear"));
    assert!(!entries[1].regulation_skipped);

    assert_eq!(entries[2].subject_id, "");
    assert!(entries[2].mean_improvement_rate.is_some());
}

#[test]
fn build_effect_history_prefers_the_latest_baseline_and_marks_skips() {
    let conn = setup_conn();
    let records = vec![
        history_record(
            &conn,
            Some("s2"),
            PHASE_BASELINE,
            None,
            false,
            "2026-08-01T09:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s2"),
            PHASE_BASELINE,
            Some("depression"),
            false,
            "2026-08-02T09:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s2"),
            PHASE_POST,
            None,
            true,
            "2026-08-02T11:00:00+00:00",
        ),
    ];

    let entries = build_effect_history(&records);

    // A dangling earlier baseline is superseded by the newer one.
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].baseline_created_at, "2026-08-02T09:00:00+00:00");
    // Emotion falls back to the baseline when the post has none.
    assert_eq!(entries[0].emotion.as_deref(), Some("depression"));
    assert!(entries[0].regulation_skipped);
}

#[test]
fn latest_entry_per_subject_emotion_keeps_newest_run_per_pair() {
    let conn = setup_conn();
    let records = vec![
        history_record(
            &conn,
            Some("s1"),
            PHASE_BASELINE,
            None,
            false,
            "2026-08-01T09:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_POST,
            None,
            false,
            "2026-08-01T10:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s2"),
            PHASE_BASELINE,
            None,
            false,
            "2026-08-02T09:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s2"),
            PHASE_POST,
            None,
            false,
            "2026-08-02T10:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_BASELINE,
            None,
            false,
            "2026-08-03T09:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_POST,
            None,
            false,
            "2026-08-03T10:00:00+00:00",
        ),
    ];

    let entries = build_effect_history(&records);
    assert_eq!(entries.len(), 3);

    let latest = latest_entry_per_subject_emotion_condition(&entries);
    assert_eq!(latest.len(), 2);
    // Ordered by subject id for stable batch output.
    assert_eq!(latest[0].subject_id, "s1");
    assert_eq!(latest[0].post_created_at, "2026-08-03T10:00:00+00:00");
    assert_eq!(latest[1].subject_id, "s2");
    assert_eq!(latest[1].post_created_at, "2026-08-02T10:00:00+00:00");
}

#[test]
fn latest_entry_per_subject_emotion_keeps_both_emotions_of_one_subject() {
    let conn = setup_conn();
    let records = vec![
        // Same subject completes an anxiety run, then a fear run, then
        // repeats only the fear run.
        history_record(
            &conn,
            Some("s1"),
            PHASE_BASELINE,
            Some("anxiety"),
            false,
            "2026-08-01T09:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_POST,
            Some("anxiety"),
            false,
            "2026-08-01T10:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_BASELINE,
            Some("fear"),
            false,
            "2026-08-02T09:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_POST,
            Some("fear"),
            false,
            "2026-08-02T10:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_BASELINE,
            Some("fear"),
            false,
            "2026-08-03T09:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_POST,
            Some("fear"),
            false,
            "2026-08-03T10:00:00+00:00",
        ),
    ];

    let entries = build_effect_history(&records);
    assert_eq!(entries.len(), 3);

    let latest = latest_entry_per_subject_emotion_condition(&entries);
    // Both emotions survive for the subject (outline 6.4 judges each
    // emotion separately), and the older fear run is dropped.
    assert_eq!(latest.len(), 2);
    assert_eq!(latest[0].emotion.as_deref(), Some("anxiety"));
    assert_eq!(latest[0].post_created_at, "2026-08-01T10:00:00+00:00");
    assert_eq!(latest[1].emotion.as_deref(), Some("fear"));
    assert_eq!(latest[1].post_created_at, "2026-08-03T10:00:00+00:00");
}

/* ---------------- R3: report content ---------------- */

#[test]
fn single_report_carries_dimensions_verdict_and_timing_facts() {
    let conn = setup_conn();

    let mut baseline = sample_input("user-1", Some("subj-r"), PHASE_BASELINE);
    baseline.dimension_scores = BTreeMap::from([("anxiety".to_string(), 80.0)]);
    baseline.emotion = Some("anxiety".to_string());
    baseline.duration_minutes = Some(5);
    let baseline = save_scale_record(&conn, &baseline).expect("save baseline");

    let mut post = sample_input("user-1", Some("subj-r"), PHASE_POST);
    post.dimension_scores = BTreeMap::from([("anxiety".to_string(), 48.0)]);
    post.emotion = Some("anxiety".to_string());
    post.condition = Some(CONDITION_NATURAL_RECOVERY.to_string());
    post.duration_minutes = Some(5);
    post.regulation_skipped = true;
    let post = save_scale_record(&conn, &post).expect("save post");

    let report = build_single_effect_report(&baseline, &post).expect("build single report");

    assert_eq!(report.subject_id.as_deref(), Some("subj-r"));
    assert_eq!(report.emotion.as_deref(), Some("anxiety"));
    assert_eq!(report.emotion_label.as_deref(), Some("焦虑"));
    // The condition travels post-first with the exported run.
    assert_eq!(
        report.condition.as_deref(),
        Some(CONDITION_NATURAL_RECOVERY)
    );
    assert_eq!(report.duration_minutes, Some(5));
    assert!(report.regulation_skipped);
    assert_eq!(report.threshold, DEFAULT_IMPROVEMENT_THRESHOLD);
    assert_eq!(report.dimensions.len(), 1);
    assert_eq!(report.dimensions[0].improvement_rate, 0.4);
    assert!(report.meets_threshold);
    assert!(!report.exported_at.is_empty());

    let json = serde_json::to_value(&report).expect("serialize report");
    assert_eq!(json["meetsThreshold"], serde_json::Value::Bool(true));
    assert_eq!(json["dimensions"][0]["baseline"], serde_json::json!(80.0));
    assert_eq!(
        json["threshold"],
        serde_json::json!(DEFAULT_IMPROVEMENT_THRESHOLD)
    );
    // Outline 6.3.5: the exported report carries the raw item scores of
    // both legs so it stays self-contained and auditable.
    assert_eq!(
        json["baselineRawAnswers"],
        serde_json::json!({ "video-anxiety-tense": 2 })
    );
    assert_eq!(
        json["postRawAnswers"],
        serde_json::json!({ "video-anxiety-tense": 2 })
    );
}

#[test]
fn single_report_rejects_mismatched_phases() {
    let conn = setup_conn();
    let baseline = save_scale_record(&conn, &sample_input("user-1", Some("s"), PHASE_BASELINE))
        .expect("save baseline");
    let another_baseline =
        save_scale_record(&conn, &sample_input("user-1", Some("s"), PHASE_BASELINE))
            .expect("save second baseline");

    assert!(build_single_effect_report(&baseline, &another_baseline).is_err());
}

#[test]
fn single_report_csv_escapes_fields_and_repeats_meta_columns() {
    let report = SingleEffectReport {
        exported_at: "2026-08-26T12:00:00+00:00".to_string(),
        subject_id: Some("subj, \"quoted\"".to_string()),
        emotion: Some("anxiety".to_string()),
        emotion_label: Some("焦虑".to_string()),
        condition: Some(CONDITION_REGULATION.to_string()),
        duration_minutes: Some(3),
        regulation_skipped: true,
        baseline_record_id: "b".to_string(),
        post_record_id: "p".to_string(),
        baseline_created_at: "2026-08-26T10:00:00+00:00".to_string(),
        post_created_at: "2026-08-26T11:00:00+00:00".to_string(),
        baseline_raw_answers: serde_json::json!({ "video-anxiety-tense": 2 }),
        post_raw_answers: serde_json::json!({ "video-anxiety-tense": 1 }),
        measured_only: true,
        threshold: DEFAULT_IMPROVEMENT_THRESHOLD,
        mean_improvement_rate: Some(-0.25),
        meets_threshold: false,
        dimensions: vec![RegulationDimensionImprovement {
            dimension: "anxiety".to_string(),
            baseline: 40.0,
            post: 50.0,
            improvement_rate: -0.25,
        }],
    };

    let csv = build_single_effect_report_csv(&report);

    assert!(csv.starts_with(CSV_BOM));
    let lines: Vec<&str> = csv.trim_start_matches(CSV_BOM).split("\r\n").collect();
    assert_eq!(lines.len(), 2);
    assert!(
        lines[0].starts_with("subject_id,emotion,condition,dimension,dimension_label,baseline",)
    );
    assert!(lines[1].contains("\"subj, \"\"quoted\"\"\""));
    // emotion,condition,dimension,dimension_label columns in order.
    assert!(lines[1].contains(",anxiety,regulation,anxiety,焦虑,"));
    assert!(lines[1].contains(",true,2026-08-26T10:00:00+00:00,"));
    assert!(lines[1].ends_with(",2026-08-26T12:00:00+00:00"));
}

#[test]
fn single_report_csv_marks_legacy_rows_without_a_condition() {
    let report = SingleEffectReport {
        exported_at: "2026-08-26T12:00:00+00:00".to_string(),
        subject_id: Some("subj-old".to_string()),
        emotion: Some("fear".to_string()),
        emotion_label: Some("恐惧".to_string()),
        // Pre-R6 rows carry no condition: the CSV says "legacy" explicitly.
        condition: None,
        duration_minutes: None,
        regulation_skipped: false,
        baseline_record_id: "b".to_string(),
        post_record_id: "p".to_string(),
        baseline_created_at: "2026-08-26T10:00:00+00:00".to_string(),
        post_created_at: "2026-08-26T11:00:00+00:00".to_string(),
        baseline_raw_answers: serde_json::json!({}),
        post_raw_answers: serde_json::json!({}),
        measured_only: false,
        threshold: DEFAULT_IMPROVEMENT_THRESHOLD,
        mean_improvement_rate: None,
        meets_threshold: false,
        dimensions: vec![RegulationDimensionImprovement {
            dimension: "anxiety".to_string(),
            baseline: 40.0,
            post: 50.0,
            improvement_rate: -0.25,
        }],
    };

    let csv = build_single_effect_report_csv(&report);
    let lines: Vec<&str> = csv.trim_start_matches(CSV_BOM).split("\r\n").collect();

    assert!(csv.starts_with(CSV_BOM));
    // emotion,condition in order: fear + legacy for a pre-R6 row.
    assert!(lines[1].contains(",fear,legacy,"));
}

#[test]
fn batch_csv_lists_one_row_per_subject_emotion_with_latest_results() {
    let entries = vec![
        EffectHistoryEntry {
            experiment_run_id: None,
            subject_id: "s1".to_string(),
            baseline_record_id: "b1".to_string(),
            post_record_id: "p1".to_string(),
            baseline_created_at: "2026-08-01T09:00:00+00:00".to_string(),
            post_created_at: "2026-08-01T10:00:00+00:00".to_string(),
            scale_id: "/music-regulation".to_string(),
            emotion: Some("anxiety".to_string()),
            condition: Some(CONDITION_REGULATION.to_string()),
            duration_minutes: Some(5),
            regulation_skipped: false,
            measured_only: true,
            mean_improvement_rate: Some(0.4),
            meets_threshold: true,
            dimensions: vec![RegulationDimensionImprovement {
                dimension: "anxiety".to_string(),
                baseline: 80.0,
                post: 48.0,
                improvement_rate: 0.4,
            }],
        },
        EffectHistoryEntry {
            experiment_run_id: None,
            subject_id: "s2".to_string(),
            baseline_record_id: "b2".to_string(),
            post_record_id: "p2".to_string(),
            baseline_created_at: "2026-08-02T09:00:00+00:00".to_string(),
            post_created_at: "2026-08-02T10:00:00+00:00".to_string(),
            scale_id: "/video-regulation".to_string(),
            emotion: None,
            condition: None,
            duration_minutes: None,
            regulation_skipped: true,
            measured_only: false,
            mean_improvement_rate: None,
            meets_threshold: false,
            dimensions: Vec::new(),
        },
    ];

    let csv = build_batch_effect_report_csv(&entries);
    let lines: Vec<&str> = csv.trim_start_matches(CSV_BOM).split("\r\n").collect();

    assert_eq!(lines.len(), 3);
    assert!(lines[0].starts_with("subject_id,emotion,condition,duration_minutes"));
    assert!(lines[1].starts_with("s1,anxiety,regulation,5,false,0.4,0.1,true,1,true,"));
    // Empty emotion collapses to a bare separator; legacy NULL conditions
    // render as "legacy" (the old regulation flow).
    assert!(lines[2].starts_with("s2,,legacy,,true,—,0.1,false,0,false,"));
}
#[test]
fn batch_csv_keeps_both_emotions_of_one_subject_after_dedup() {
    let conn = setup_conn();
    let records = vec![
        history_record(
            &conn,
            Some("s1"),
            PHASE_BASELINE,
            Some("anxiety"),
            false,
            "2026-08-01T09:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_POST,
            Some("anxiety"),
            false,
            "2026-08-01T10:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_BASELINE,
            Some("fear"),
            false,
            "2026-08-02T09:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_POST,
            Some("fear"),
            false,
            "2026-08-02T10:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_BASELINE,
            Some("fear"),
            false,
            "2026-08-03T09:00:00+00:00",
        ),
        history_record(
            &conn,
            Some("s1"),
            PHASE_POST,
            Some("fear"),
            false,
            "2026-08-03T10:00:00+00:00",
        ),
    ];

    let history = build_effect_history(&records);
    let csv = build_batch_effect_report_csv(&latest_entry_per_subject_emotion_condition(&history));
    let lines: Vec<&str> = csv.trim_start_matches(CSV_BOM).split("\r\n").collect();

    // One row per (subject, emotion, condition): the subject keeps both
    // its anxiety and fear verdicts, and only the newest fear run survives.
    assert_eq!(lines.len(), 3);
    assert!(lines[1].starts_with("s1,anxiety,"));
    assert!(lines[2].starts_with("s1,fear,"));
    assert!(lines[2].contains("2026-08-03T10:00:00+00:00"));
    assert!(!lines
        .iter()
        .any(|line| line.contains("2026-08-02T10:00:00+00:00")));
}

/* ---------------- R6: cross-condition comparison ---------------- */

/// Saves one record with pinned scores and timestamp for the
/// cross-condition fixtures; emotion and condition ride on the record.
fn condition_record(
    conn: &Connection,
    subject: &str,
    phase: &str,
    emotion: &str,
    condition: Option<&str>,
    scores: serde_json::Value,
    stamp: &str,
) -> ScaleRecord {
    let mut input = sample_input("user-1", Some(subject), phase);
    input.emotion = Some(emotion.to_string());
    input.condition = condition.map(str::to_string);
    let saved = save_scale_record(conn, &input).expect("save condition record");

    conn.execute(
        "UPDATE scale_records SET dimension_scores = ?1, created_at = ?2 WHERE id = ?3",
        params![scores.to_string(), stamp, saved.id],
    )
    .expect("pin condition record");
    get_scale_record(conn, &saved.id).expect("reload pinned record")
}

/// One complete run (baseline + post) under a condition with pinned scores.
fn condition_run(
    conn: &Connection,
    subject: &str,
    emotion: &str,
    condition: Option<&str>,
    baseline_scores: serde_json::Value,
    post_scores: serde_json::Value,
    day: &str,
) -> Vec<ScaleRecord> {
    vec![
        condition_record(
            conn,
            subject,
            PHASE_BASELINE,
            emotion,
            condition,
            baseline_scores,
            &format!("2026-08-{day}T09:00:00+00:00"),
        ),
        condition_record(
            conn,
            subject,
            PHASE_POST,
            emotion,
            condition,
            post_scores,
            &format!("2026-08-{day}T10:00:00+00:00"),
        ),
    ]
}

#[test]
fn effective_condition_maps_legacy_null_to_the_regulation_condition() {
    assert_eq!(effective_condition(None), CONDITION_REGULATION);
    assert_eq!(
        effective_condition(Some(CONDITION_REGULATION)),
        CONDITION_REGULATION
    );
    assert_eq!(
        effective_condition(Some(CONDITION_NATURAL_RECOVERY)),
        CONDITION_NATURAL_RECOVERY
    );
}

#[test]
fn latest_entry_per_subject_emotion_condition_keeps_one_row_per_triple() {
    let conn = setup_conn();
    // s1 anxiety: two regulation runs (legacy NULL + explicit), one
    // natural-recovery run, plus one fear regulation run.
    let mut records = condition_run(
        &conn,
        "s1",
        "anxiety",
        None,
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 48.0 }),
        "01",
    );
    records.extend(condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_REGULATION),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 60.0 }),
        "02",
    ));
    records.extend(condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_NATURAL_RECOVERY),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 70.0 }),
        "03",
    ));
    records.extend(condition_run(
        &conn,
        "s1",
        "fear",
        Some(CONDITION_REGULATION),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 40.0 }),
        "04",
    ));

    let entries = build_effect_history(&records);
    let latest = latest_entry_per_subject_emotion_condition(&entries);

    // The legacy NULL run and the explicit regulation run collapse into
    // the same (subject, emotion, regulation) triple - the newer one wins.
    assert_eq!(latest.len(), 3);
    let triples: Vec<(String, Option<String>, String)> = latest
        .iter()
        .map(|entry| {
            (
                entry.subject_id.clone(),
                entry.emotion.clone(),
                effective_condition(entry.condition.as_deref()).to_string(),
            )
        })
        .collect();
    assert!(triples.contains(&(
        "s1".to_string(),
        Some("anxiety".to_string()),
        CONDITION_REGULATION.to_string()
    )));
    assert!(triples.contains(&(
        "s1".to_string(),
        Some("anxiety".to_string()),
        CONDITION_NATURAL_RECOVERY.to_string()
    )));
    assert!(triples.contains(&(
        "s1".to_string(),
        Some("fear".to_string()),
        CONDITION_REGULATION.to_string()
    )));

    let regulation_row = latest
        .iter()
        .find(|entry| {
            entry.emotion.as_deref() == Some("anxiety")
                && effective_condition(entry.condition.as_deref()) == CONDITION_REGULATION
        })
        .expect("find anxiety regulation row");
    assert_eq!(regulation_row.post_created_at, "2026-08-02T10:00:00+00:00");
}

#[test]
fn build_effect_history_pairs_only_within_the_same_condition() {
    let conn = setup_conn();

    // A legacy (NULL-condition) baseline must not feed a natural-recovery
    // post (R7: the pairing key is subject+condition), and vice versa.
    let records = condition_run(
        &conn,
        "s9",
        "anxiety",
        Some(CONDITION_NATURAL_RECOVERY),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 70.0 }),
        "01",
    );
    conn.execute(
        "UPDATE scale_records SET condition = NULL WHERE id = ?1",
        params![records[0].id],
    )
    .expect("clear baseline condition");
    let mixed = list_scale_records(&conn, None, None).expect("list");
    assert_eq!(build_effect_history(&mixed).len(), 0);

    // Same-condition legs pair and carry the run's condition.
    let mut records = condition_run(
        &conn,
        "s9",
        "anxiety",
        Some(CONDITION_NATURAL_RECOVERY),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 70.0 }),
        "02",
    );
    records.extend(condition_run(
        &conn,
        "s9",
        "anxiety",
        None,
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 60.0 }),
        "03",
    ));

    let entries = build_effect_history(&list_scale_records(&conn, None, None).expect("list"));
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].subject_id, "s9");
    assert_eq!(
        entries[0].condition.as_deref(),
        Some(CONDITION_NATURAL_RECOVERY)
    );
    // Legacy rows pair among themselves under the NULL key.
    assert_eq!(entries[1].condition, None);
}

#[test]
fn condition_comparison_uses_the_latest_run_of_each_condition() {
    let conn = setup_conn();
    let mut records = condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_REGULATION),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 48.0 }),
        "01",
    );
    records.extend(condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_REGULATION),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 60.0 }),
        "02",
    ));
    records.extend(condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_NATURAL_RECOVERY),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 70.0 }),
        "03",
    ));

    let comparison =
        compute_condition_effect_comparison(&records, "s1", "anxiety").expect("compare");

    assert_eq!(comparison.subject_id, "s1");
    assert_eq!(comparison.emotion.as_deref(), Some("anxiety"));
    // The regulation side is the newest run (08-02), not the 08-01 one.
    assert_eq!(
        comparison.regulation_leg.post_created_at,
        "2026-08-02T10:00:00+00:00"
    );
    assert_eq!(
        comparison.natural_recovery_leg.post_created_at,
        "2026-08-03T10:00:00+00:00"
    );
    // R7: each leg carries the full trace of the run it was built from.
    assert_eq!(
        comparison.natural_recovery_leg.condition,
        CONDITION_NATURAL_RECOVERY
    );
    assert_eq!(comparison.regulation_leg.condition, CONDITION_REGULATION);
    assert_eq!(
        comparison.natural_recovery_leg.emotion.as_deref(),
        Some("anxiety")
    );
    assert!(!comparison.regulation_leg.baseline_record_id.is_empty());
    assert!(!comparison.regulation_leg.post_record_id.is_empty());
    assert_eq!(
        comparison.natural_recovery_leg.scale_id,
        comparison.regulation_leg.scale_id
    );
    // (B_post - T_post) / B_post = (70 - 60) / 70.
    assert_eq!(comparison.dimensions.len(), 1);
    assert_eq!(comparison.dimensions[0].dimension, "anxiety");
    assert_eq!(comparison.dimensions[0].natural_recovery_post, 70.0);
    assert_eq!(comparison.dimensions[0].regulation_post, 60.0);
    assert!((comparison.dimensions[0].improvement_rate - 10.0 / 70.0).abs() < 1e-9);

    let mean = comparison.mean_improvement_rate.expect("mean present");
    assert!((mean - 10.0 / 70.0).abs() < 1e-9);
    assert!(comparison.meets_threshold);
}

#[test]
fn condition_comparison_is_identical_when_unbound_rows_are_filtered_out() {
    // Mirrors the caller-side subject pushdown in compute_condition_effect
    // / the comparison export: NULL-subject rows group under "" in
    // build_effect_history and can never match a non-empty target subject,
    // so excluding them in SQL must leave the comparison untouched.
    let conn = setup_conn();
    let mut records = condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_NATURAL_RECOVERY),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 70.0 }),
        "01",
    );
    records.extend(condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_REGULATION),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 60.0 }),
        "02",
    ));
    // A complete run saved without a subject (blank subject ids are stored
    // as NULL) — invisible to the target subject either way.
    records.extend(condition_run(
        &conn,
        "",
        "anxiety",
        Some(CONDITION_REGULATION),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 10.0 }),
        "03",
    ));

    let all = list_scale_records(&conn, None, None).expect("list all records");
    let pushed = list_scale_records(&conn, Some("s1"), None).expect("list subject records");
    assert!(pushed.len() < all.len());

    let expected = compute_condition_effect_comparison(&all, "s1", "anxiety").expect("compare all");
    let actual =
        compute_condition_effect_comparison(&pushed, "s1", "anxiety").expect("compare pushed");
    assert_eq!(actual, expected);
}

#[test]
fn condition_comparison_rejects_legacy_legs_with_an_explicit_reason() {
    let conn = setup_conn();
    // The regulation run is a legacy pre-R6 pair (condition NULL): it must
    // not silently enter the comparison as the regulation leg.
    let mut records = condition_run(
        &conn,
        "s1",
        "anxiety",
        None,
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 40.0 }),
        "01",
    );
    records.extend(condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_NATURAL_RECOVERY),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 50.0 }),
        "02",
    ));

    let error = compute_condition_effect_comparison(&records, "s1", "anxiety")
        .expect_err("legacy regulation leg must be rejected");
    assert!(error.contains("旧流程"));
    assert!(error.contains("诱发"));
    assert!(error.contains("大纲 6.2"));

    // Only legacy regulation rows exist: the missing-leg error names the
    // legacy reason instead of a generic "missing regulation" line.
    let legacy_only = condition_run(
        &conn,
        "s2",
        "anxiety",
        None,
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 40.0 }),
        "01",
    );
    let error = compute_condition_effect_comparison(&legacy_only, "s2", "anxiety")
        .expect_err("natural-recovery leg still missing");
    // The natural-recovery leg is the missing side here; the legacy-only
    // regulation side is surfaced once both conditions exist (above).
    assert!(error.contains("自然恢复"));

    let mut both_missing = legacy_only;
    both_missing.extend(condition_run(
        &conn,
        "s2",
        "anxiety",
        Some(CONDITION_NATURAL_RECOVERY),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 50.0 }),
        "02",
    ));
    let error = compute_condition_effect_comparison(&both_missing, "s2", "anxiety")
        .expect_err("regulation leg is legacy only");
    assert!(error.contains("旧流程"));
    assert!(error.contains("诱发后测量口径"));
}

#[test]
fn condition_comparison_rejects_legs_saved_with_different_scales() {
    let conn = setup_conn();
    let mut records = condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_NATURAL_RECOVERY),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 70.0 }),
        "01",
    );
    records.extend(condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_REGULATION),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 60.0 }),
        "02",
    ));
    // Retag the regulation run's rows as a different scale (music), as a
    // same-named-dimension different-scale pairing would be.
    for record in &records[2..] {
        conn.execute(
            "UPDATE scale_records SET scale_id = ?1 WHERE id = ?2",
            params!["/music-regulation", record.id],
        )
        .expect("retag scale");
    }
    // Reload so the comparison sees the retagged rows, not the stale
    // in-memory structs.
    let records = list_scale_records(&conn, None, None).expect("reload records");

    let error = compute_condition_effect_comparison(&records, "s1", "anxiety")
        .expect_err("scale mismatch must be rejected");
    assert!(error.contains("量表不一致"));
    assert!(error.contains("/video-regulation"));
    assert!(error.contains("/music-regulation"));
}

#[test]
fn condition_comparison_requires_a_complete_run_of_both_conditions() {
    let conn = setup_conn();
    let regulation_only = condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_REGULATION),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 40.0 }),
        "01",
    );
    let natural_only = condition_run(
        &conn,
        "s2",
        "anxiety",
        Some(CONDITION_NATURAL_RECOVERY),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 50.0 }),
        "01",
    );
    let other_emotion = condition_run(
        &conn,
        "s1",
        "fear",
        Some(CONDITION_NATURAL_RECOVERY),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 50.0 }),
        "02",
    );

    // Regulation runs only: the natural-recovery side is missing.
    let missing_natural =
        compute_condition_effect_comparison(&regulation_only, "s1", "anxiety").unwrap_err();
    assert!(missing_natural.contains("自然恢复"));

    // Natural-recovery runs only (and a different emotion never matches).
    let missing_regulation = compute_condition_effect_comparison(
        &[natural_only.clone(), other_emotion].concat(),
        "s2",
        "anxiety",
    )
    .unwrap_err();
    assert!(missing_regulation.contains("调控条件"));

    // Blank identifiers are rejected before any pairing.
    assert_eq!(
        compute_condition_effect_comparison(&natural_only, "   ", "anxiety").unwrap_err(),
        "Subject id is required."
    );
    assert_eq!(
        compute_condition_effect_comparison(&natural_only, "s2", "  ").unwrap_err(),
        "Emotion is required."
    );
}

#[test]
fn condition_comparison_skips_zero_b_post_and_unshared_dimensions() {
    let conn = setup_conn();
    // mood is missing on the regulation post, anxiety has a zero B_post.
    let mut records = condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_NATURAL_RECOVERY),
        json!({ "anxiety": 80.0, "mood": 60.0 }),
        json!({ "anxiety": 70.0, "mood": 0.0 }),
        "01",
    );
    records.extend(condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_REGULATION),
        json!({ "anxiety": 80.0, "mood": 60.0 }),
        json!({ "anxiety": 60.0 }),
        "02",
    ));

    let comparison =
        compute_condition_effect_comparison(&records, "s1", "anxiety").expect("compare");

    // Only anxiety survives (mood missing on one post, zero on the other).
    let compared: Vec<&str> = comparison
        .dimensions
        .iter()
        .map(|item| item.dimension.as_str())
        .collect();
    assert_eq!(compared, vec!["anxiety"]);

    // With every B_post at zero the mean is undefined and nothing passes.
    let mut all_zero = condition_run(
        &conn,
        "s2",
        "anxiety",
        Some(CONDITION_NATURAL_RECOVERY),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 0.0 }),
        "01",
    );
    all_zero.extend(condition_run(
        &conn,
        "s2",
        "anxiety",
        Some(CONDITION_REGULATION),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 60.0 }),
        "02",
    ));
    let undecidable =
        compute_condition_effect_comparison(&all_zero, "s2", "anxiety").expect("compare");
    assert!(undecidable.dimensions.is_empty());
    assert_eq!(undecidable.mean_improvement_rate, None);
    assert!(!undecidable.meets_threshold);
}

#[test]
fn condition_comparison_threshold_boundary_includes_the_threshold_itself() {
    let conn = setup_conn();
    // (B_post - T_post) / B_post = (100 - 90) / 100 = exactly 0.10.
    let mut records = condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_NATURAL_RECOVERY),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 100.0 }),
        "01",
    );
    records.extend(condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_REGULATION),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 90.0 }),
        "02",
    ));

    let comparison =
        compute_condition_effect_comparison(&records, "s1", "anxiety").expect("compare");

    assert_eq!(
        comparison.dimensions[0].improvement_rate,
        DEFAULT_IMPROVEMENT_THRESHOLD
    );
    assert_eq!(
        comparison.mean_improvement_rate,
        Some(DEFAULT_IMPROVEMENT_THRESHOLD)
    );
    assert!(comparison.meets_threshold);
}

#[test]
fn condition_comparison_propagates_the_measured_only_basis() {
    let conn = setup_conn();
    // Both conditions mark their measured dimensions.
    let marked = |phase: &str, condition: &str, scores: serde_json::Value, stamp: &str| {
        let mut input = sample_input("user-1", Some("s1"), phase);
        input.emotion = Some("anxiety".to_string());
        input.condition = Some(condition.to_string());
        input.measured_dimensions = Some(vec!["anxiety".to_string()]);
        let saved = save_scale_record(&conn, &input).expect("save marked record");
        conn.execute(
            "UPDATE scale_records SET dimension_scores = ?1, created_at = ?2 WHERE id = ?3",
            params![scores.to_string(), stamp, saved.id],
        )
        .expect("pin marked record");
        get_scale_record(&conn, &saved.id).expect("reload marked record")
    };

    let records = vec![
        marked(
            PHASE_BASELINE,
            CONDITION_NATURAL_RECOVERY,
            json!({ "anxiety": 80.0, "worry": 50.0 }),
            "2026-08-01T09:00:00+00:00",
        ),
        marked(
            PHASE_POST,
            CONDITION_NATURAL_RECOVERY,
            json!({ "anxiety": 70.0, "worry": 50.0 }),
            "2026-08-01T10:00:00+00:00",
        ),
        marked(
            PHASE_BASELINE,
            CONDITION_REGULATION,
            json!({ "anxiety": 80.0, "worry": 50.0 }),
            "2026-08-02T09:00:00+00:00",
        ),
        marked(
            PHASE_POST,
            CONDITION_REGULATION,
            json!({ "anxiety": 60.0, "worry": 50.0 }),
            "2026-08-02T10:00:00+00:00",
        ),
    ];
    let comparison =
        compute_condition_effect_comparison(&records, "s1", "anxiety").expect("compare");
    // The placeholder `worry` never entered either side's dims.
    assert!(comparison.measured_only);
    assert_eq!(comparison.dimensions.len(), 1);

    // One unmarked (legacy) side drops the flag back to false.
    let mut mixed = records.clone();
    mixed[2].measured_dimensions = None;
    mixed[3].measured_dimensions = None;
    let mixed_comparison =
        compute_condition_effect_comparison(&mixed, "s1", "anxiety").expect("compare");
    assert!(!mixed_comparison.measured_only);
}

/* ---------------- R7: cross-condition comparison export ---------------- */

#[test]
fn comparison_report_carries_legs_formula_and_verdict() {
    let conn = setup_conn();
    // Post legs carry the run facts (skip marker, EEG link, duration) so
    // the report document stays self-contained and auditable.
    condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_NATURAL_RECOVERY),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 100.0 }),
        "01",
    );
    let regulation = condition_run(
        &conn,
        "s1",
        "anxiety",
        Some(CONDITION_REGULATION),
        json!({ "anxiety": 80.0 }),
        json!({ "anxiety": 90.0 }),
        "02",
    );
    for record in &regulation {
        let record_id = record.id.clone();
        conn.execute(
            "UPDATE scale_records SET regulation_skipped = 1, duration_minutes = 5 WHERE id = ?1",
            params![record_id],
        )
        .expect("stamp regulation run facts");
    }
    // Reload so the comparison sees the stamped rows, not the stale
    // in-memory structs.
    let records = list_scale_records(&conn, None, None).expect("reload records");

    let comparison =
        compute_condition_effect_comparison(&records, "s1", "anxiety").expect("compare");
    let report = build_condition_comparison_report(&comparison);

    assert_eq!(report.subject_id, "s1");
    assert_eq!(report.emotion.as_deref(), Some("anxiety"));
    assert_eq!(report.emotion_label.as_deref(), Some("焦虑"));
    assert_eq!(report.threshold, DEFAULT_IMPROVEMENT_THRESHOLD);
    // (100 - 90) / 100 = exactly the threshold: verdict true.
    assert_eq!(
        report.mean_improvement_rate,
        Some(DEFAULT_IMPROVEMENT_THRESHOLD)
    );
    assert!(report.meets_threshold);
    // The formula statement names the frozen default 口径.
    assert!(report.formula.contains("B_post"));
    assert!(report.formula.contains("T_post"));
    assert!(report.formula.contains("B-1"));
    // Both legs' trace travels with the document.
    assert_eq!(
        report.natural_recovery_leg.condition,
        CONDITION_NATURAL_RECOVERY
    );
    assert_eq!(report.regulation_leg.condition, CONDITION_REGULATION);
    assert!(report.regulation_leg.regulation_skipped);
    assert_eq!(report.regulation_leg.duration_minutes, Some(5));
    assert!(!report.exported_at.is_empty());

    // camelCase JSON shape (the export writes exactly this document).
    let json = serde_json::to_value(&report).expect("serialize report");
    assert_eq!(
        json["naturalRecoveryLeg"]["condition"],
        serde_json::json!("natural_recovery")
    );
    assert_eq!(
        json["dimensions"][0]["naturalRecoveryPost"],
        serde_json::json!(100.0)
    );
    assert_eq!(json["meetsThreshold"], serde_json::Value::Bool(true));
    assert!(json["formula"]
        .as_str()
        .expect("formula string")
        .contains("B-1"));
}

#[test]
fn comparison_report_csv_repeats_leg_columns_and_the_formula() {
    let comparison = ConditionEffectComparison {
        subject_id: "subj, \"quoted\"".to_string(),
        emotion: Some("anxiety".to_string()),
        natural_recovery_leg: ConditionComparisonLeg {
            experiment_run_id: None,
            condition: CONDITION_NATURAL_RECOVERY.to_string(),
            emotion: Some("anxiety".to_string()),
            baseline_record_id: "b-nr".to_string(),
            post_record_id: "p-nr".to_string(),
            baseline_created_at: "2026-08-28T09:00:00+00:00".to_string(),
            post_created_at: "2026-08-28T10:00:00+00:00".to_string(),
            scale_id: "/video-regulation".to_string(),
            duration_minutes: Some(5),
            regulation_skipped: false,
            measured_only: true,
        },
        regulation_leg: ConditionComparisonLeg {
            experiment_run_id: None,
            condition: CONDITION_REGULATION.to_string(),
            emotion: Some("anxiety".to_string()),
            baseline_record_id: "b-reg".to_string(),
            post_record_id: "p-reg".to_string(),
            baseline_created_at: "2026-08-28T11:00:00+00:00".to_string(),
            post_created_at: "2026-08-28T12:00:00+00:00".to_string(),
            scale_id: "/video-regulation".to_string(),
            duration_minutes: Some(5),
            regulation_skipped: true,
            measured_only: true,
        },
        dimensions: vec![ConditionDimensionComparison {
            dimension: "anxiety".to_string(),
            natural_recovery_post: 50.0,
            regulation_post: 40.0,
            improvement_rate: 0.2,
        }],
        mean_improvement_rate: Some(0.2),
        meets_threshold: true,
        measured_only: true,
    };
    let report = build_condition_comparison_report(&comparison);
    // Pin the timestamp so the row's trailing column is deterministic.
    let report = ConditionComparisonReport {
        exported_at: "2026-08-28T12:30:00+00:00".to_string(),
        ..report
    };

    let csv = build_condition_comparison_report_csv(&report);
    let lines: Vec<&str> = csv.trim_start_matches(CSV_BOM).split("\r\n").collect();

    assert!(csv.starts_with(CSV_BOM));
    assert_eq!(lines.len(), 2);
    assert!(lines[0].starts_with(
            "subject_id,emotion,dimension,dimension_label,natural_recovery_post,regulation_post,improvement_rate",
        ));
    assert!(lines[0].contains("mean_improvement_rate,threshold,meets_threshold,measured_only"));
    assert!(lines[0].contains("natural_recovery_post_record_id,regulation_post_record_id"));
    assert!(lines[0].ends_with("formula,exported_at"));
    // Meta columns repeat per dimension row, single-report style.
    assert!(lines[1].contains("\"subj, \"\"quoted\"\"\""));
    assert!(lines[1].contains(",anxiety,anxiety,焦虑,50,40,0.2,"));
    assert!(lines[1].contains("2026-08-28T10:00:00+00:00,2026-08-28T12:00:00+00:00,"));
    // The formula statement rides along as a (quoted) column value.
    assert!(lines[1].contains("大纲 B-1 冻结项"));
    assert!(lines[1].ends_with(",2026-08-28T12:30:00+00:00"));
}
