use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

/// Phases of the emotion-regulation evaluation loop: a scale answered before
/// a regulation activity (`baseline`) and again afterwards (`post`).
pub const PHASE_BASELINE: &str = "baseline";
pub const PHASE_POST: &str = "post";

/// Default relative improvement required to consider a regulation effective.
pub const DEFAULT_IMPROVEMENT_THRESHOLD: f64 = 0.10;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveScaleRecordInput {
    pub user_id: String,
    pub subject_id: Option<String>,
    pub scale_id: String,
    pub phase: String,
    pub dimension_scores: BTreeMap<String, f64>,
    pub raw_answers: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaleRecord {
    pub id: String,
    pub user_id: String,
    pub subject_id: Option<String>,
    pub scale_id: String,
    pub phase: String,
    pub dimension_scores: serde_json::Value,
    pub raw_answers: serde_json::Value,
    pub created_at: String,
}

/// Per-dimension improvement between the baseline and post regulation
/// measurements: `(baseline - post) / baseline`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegulationDimensionImprovement {
    pub dimension: String,
    pub baseline: f64,
    pub post: f64,
    pub improvement_rate: f64,
}

/// Aggregated regulation effect for one subject's baseline/post scale pair.
///
/// Dimensions missing on either side (or with a zero baseline, which makes the
/// improvement rate undefined) are excluded; the mean covers only comparable
/// dimensions and is `None` when none remain.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegulationEffectSummary {
    pub subject_id: Option<String>,
    pub dimensions: Vec<RegulationDimensionImprovement>,
    pub mean_improvement_rate: Option<f64>,
}

impl RegulationEffectSummary {
    /// The loop target: the subject improved by at least the default
    /// threshold on average across comparable dimensions.
    /// Part of the regulation-effect API; consumed by tests until the
    /// evaluation round reads persisted pairs back.
    #[allow(dead_code)]
    pub fn meets_threshold(&self) -> bool {
        self.meets_threshold_at(DEFAULT_IMPROVEMENT_THRESHOLD)
    }

    #[allow(dead_code)]
    pub fn meets_threshold_at(&self, threshold: f64) -> bool {
        self.mean_improvement_rate
            .map_or(false, |mean| mean >= threshold)
    }
}

pub fn init_scale_records_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scale_records (
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
        CREATE INDEX IF NOT EXISTS idx_scale_records_subject_phase
            ON scale_records(subject_id, phase);",
    )
    .map_err(|_| "Failed to initialize scale records schema.".to_string())
}

pub fn save_scale_record(
    conn: &Connection,
    input: &SaveScaleRecordInput,
) -> Result<ScaleRecord, String> {
    let user_id = input.user_id.trim();
    if user_id.is_empty() {
        return Err("User id is required.".to_string());
    }

    let scale_id = input.scale_id.trim();
    if scale_id.is_empty() {
        return Err("Scale id is required.".to_string());
    }

    validate_phase(input.phase.trim())?;

    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    let dimension_scores =
        serde_json::to_string(&input.dimension_scores).unwrap_or_else(|_| "{}".to_string());
    let raw_answers =
        serde_json::to_string(&input.raw_answers).unwrap_or_else(|_| "{}".to_string());

    conn.execute(
        "INSERT INTO scale_records
            (id, user_id, subject_id, scale_id, phase, dimension_scores, raw_answers, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            user_id,
            input.subject_id.as_deref().map(str::trim).filter(|v| !v.is_empty()),
            scale_id,
            input.phase.trim(),
            dimension_scores,
            raw_answers,
            created_at,
        ],
    )
    .map_err(|_| "Failed to save scale record.".to_string())?;

    Ok(ScaleRecord {
        id,
        user_id: user_id.to_string(),
        subject_id: input
            .subject_id
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string),
        scale_id: scale_id.to_string(),
        phase: input.phase.trim().to_string(),
        dimension_scores: serde_json::from_str(&dimension_scores).unwrap_or_default(),
        raw_answers: serde_json::from_str(&raw_answers).unwrap_or_default(),
        created_at,
    })
}

pub fn list_scale_records(
    conn: &Connection,
    subject_id: Option<&str>,
    phase: Option<&str>,
) -> Result<Vec<ScaleRecord>, String> {
    let subject_id = subject_id.map(str::trim).filter(|value| !value.is_empty());
    let phase = phase.map(str::trim).filter(|value| !value.is_empty());

    if let Some(phase) = phase {
        validate_phase(phase)?;
    }

    // Chronological order so a subject's baseline precedes its post record.
    let mut stmt = conn
        .prepare_cached(
            "SELECT id, user_id, subject_id, scale_id, phase, dimension_scores, raw_answers, created_at
                FROM scale_records
                WHERE (?1 IS NULL OR subject_id = ?1)
                  AND (?2 IS NULL OR phase = ?2)
                ORDER BY created_at ASC",
        )
        .map_err(|_| "Failed to load scale records.".to_string())?;

    let rows = stmt
        .query_map(params![subject_id, phase], |row| {
            Ok(RecordRow {
                id: row.get(0)?,
                user_id: row.get(1)?,
                subject_id: row.get(2)?,
                scale_id: row.get(3)?,
                phase: row.get(4)?,
                dimension_scores: row.get(5)?,
                raw_answers: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|_| "Failed to load scale records.".to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Failed to load scale records.".to_string())?
        .into_iter()
        .map(parse_record_row)
        .collect()
}

pub fn delete_scale_record(conn: &Connection, id: &str) -> Result<ScaleRecord, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT id, user_id, subject_id, scale_id, phase, dimension_scores, raw_answers, created_at
                FROM scale_records WHERE id = ?1",
        )
        .map_err(|_| "Failed to load scale record.".to_string())?;

    let row = stmt
        .query_row(params![id], |row| {
            Ok(RecordRow {
                id: row.get(0)?,
                user_id: row.get(1)?,
                subject_id: row.get(2)?,
                scale_id: row.get(3)?,
                phase: row.get(4)?,
                dimension_scores: row.get(5)?,
                raw_answers: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|_| "Scale record not found.".to_string())?;

    conn.execute("DELETE FROM scale_records WHERE id = ?1", params![id])
        .map_err(|_| "Failed to delete scale record.".to_string())?;

    parse_record_row(row)
}

/// Compares one subject's baseline and post scale records dimension by
/// dimension. Both records must carry the expected phase; when both carry a
/// subject id they must agree (a missing id means "unknown" and passes).
/// Part of the regulation-effect API; consumed by tests until the evaluation
/// round reads persisted pairs back.
#[allow(dead_code)]
pub fn compute_regulation_effect_summary(
    baseline: &ScaleRecord,
    post: &ScaleRecord,
) -> Result<RegulationEffectSummary, String> {
    if baseline.phase != PHASE_BASELINE {
        return Err(format!(
            "The first record must have phase '{PHASE_BASELINE}'."
        ));
    }
    if post.phase != PHASE_POST {
        return Err(format!("The second record must have phase '{PHASE_POST}'."));
    }

    if let (Some(baseline_subject), Some(post_subject)) =
        (&baseline.subject_id, &post.subject_id)
    {
        if baseline_subject.trim() != post_subject.trim() {
            return Err(
                "Baseline and post records belong to different subjects.".to_string(),
            );
        }
    }

    let baseline_scores = parse_dimension_scores(&baseline.dimension_scores)?;
    let post_scores = parse_dimension_scores(&post.dimension_scores)?;

    let mut dimensions = Vec::new();
    for (dimension, baseline_value) in &baseline_scores {
        // Missing on the post side: no comparison possible for this dimension.
        let Some(post_value) = post_scores.get(dimension) else {
            continue;
        };
        // Zero baseline: the improvement rate would divide by zero, skip it.
        if *baseline_value == 0.0 {
            continue;
        }

        dimensions.push(RegulationDimensionImprovement {
            dimension: dimension.clone(),
            baseline: *baseline_value,
            post: *post_value,
            improvement_rate: (*baseline_value - post_value) / baseline_value,
        });
    }

    let mean_improvement_rate = if dimensions.is_empty() {
        None
    } else {
        Some(
            dimensions
                .iter()
                .map(|item| item.improvement_rate)
                .sum::<f64>()
                / dimensions.len() as f64,
        )
    };

    Ok(RegulationEffectSummary {
        subject_id: baseline.subject_id.clone(),
        dimensions,
        mean_improvement_rate,
    })
}

fn validate_phase(phase: &str) -> Result<(), String> {
    if phase == PHASE_BASELINE || phase == PHASE_POST {
        return Ok(());
    }

    Err(format!(
        "Scale record phase must be '{PHASE_BASELINE}' or '{PHASE_POST}'."
    ))
}

struct RecordRow {
    id: String,
    user_id: String,
    subject_id: Option<String>,
    scale_id: String,
    phase: String,
    dimension_scores: String,
    raw_answers: String,
    created_at: String,
}

fn parse_record_row(row: RecordRow) -> Result<ScaleRecord, String> {
    Ok(ScaleRecord {
        id: row.id,
        user_id: row.user_id,
        subject_id: row.subject_id,
        scale_id: row.scale_id,
        phase: row.phase,
        // Strict parse: silently degrading to an empty map would hide corrupt
        // rows from the effect computation below.
        dimension_scores: serde_json::from_str(&row.dimension_scores)
            .map_err(|_| "Failed to parse stored dimension scores.".to_string())?,
        raw_answers: serde_json::from_str(&row.raw_answers)
            .map_err(|_| "Failed to parse stored raw answers.".to_string())?,
        created_at: row.created_at,
    })
}

fn parse_dimension_scores(value: &serde_json::Value) -> Result<BTreeMap<String, f64>, String> {
    serde_json::from_value(value.clone())
        .map_err(|_| "Failed to parse dimension scores.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
        assert_eq!(saved_baseline.raw_answers["video-anxiety-tense"], 2);
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

        let records =
            list_scale_records(&conn, Some("subject-1"), None).expect("list records");
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].id, saved_baseline.id);
        assert_eq!(records[1].id, saved_post.id);
        assert_eq!(records[0].phase, PHASE_BASELINE);
        assert_eq!(records[1].phase, PHASE_POST);
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

        let saved = save_scale_record(
            &conn,
            &sample_input("user-1", Some("   "), PHASE_BASELINE),
        )
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

        let by_subject =
            list_scale_records(&conn, Some("subject-2"), None).expect("filter subject");
        assert_eq!(by_subject.len(), 1);
        assert_eq!(by_subject[0].phase, PHASE_BASELINE);

        let by_phase = list_scale_records(&conn, None, Some(PHASE_POST)).expect("filter phase");
        assert_eq!(by_phase.len(), 1);
        assert_eq!(by_phase[0].subject_id.as_deref(), Some("subject-1"));

        let both = list_scale_records(&conn, Some("subject-1"), Some(PHASE_BASELINE))
            .expect("filter both");
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

        let deleted = delete_scale_record(&conn, &saved.id).expect("delete record");
        assert_eq!(deleted.id, saved.id);
        assert!(list_scale_records(&conn, None, None)
            .expect("list records")
            .is_empty());

        assert_eq!(
            delete_scale_record(&conn, &saved.id).unwrap_err(),
            "Scale record not found."
        );
    }

    #[test]
    fn enforces_user_foreign_key() {
        let conn = setup_conn();

        assert_eq!(
            save_scale_record(&conn, &sample_input("missing-user", None, PHASE_BASELINE))
                .unwrap_err(),
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
        let mut post = save_scale_record(
            conn,
            &sample_input("user-1", Some("subject-1"), PHASE_POST),
        )
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

        let summary =
            compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

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

        let summary =
            compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

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

        let summary =
            compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

        assert_eq!(summary.dimensions.len(), 1);
        assert_eq!(summary.dimensions[0].dimension, "mood");
        assert_eq!(summary.dimensions[0].improvement_rate, 0.1);
    }

    #[test]
    fn reports_no_mean_when_no_dimension_is_comparable() {
        let conn = setup_conn();
        let (baseline, post) = persisted_pair(
            &conn,
            json!({ "anxiety": 0.0 }),
            json!({ "mood": 30.0 }),
        );

        let summary =
            compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

        assert!(summary.dimensions.is_empty());
        assert_eq!(summary.mean_improvement_rate, None);
        assert!(!summary.meets_threshold());
    }

    #[test]
    fn allows_negative_improvement_when_state_worsens() {
        let conn = setup_conn();
        let (baseline, post) = persisted_pair(
            &conn,
            json!({ "mood": 40.0 }),
            json!({ "mood": 60.0 }),
        );

        let summary =
            compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

        assert_eq!(summary.dimensions[0].improvement_rate, -0.5);
        assert!(!summary.meets_threshold());
    }

    #[test]
    fn rejects_swapped_or_wrong_phases() {
        let conn = setup_conn();
        let (baseline, post) = persisted_pair(
            &conn,
            json!({ "mood": 40.0 }),
            json!({ "mood": 30.0 }),
        );

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
        let mut anonymous = save_scale_record(
            &conn,
            &sample_input("user-1", None, PHASE_POST),
        )
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
        let (baseline, post) = persisted_pair(
            &conn,
            json!({ "mood": 10.0 }),
            json!({ "mood": 9.0 }),
        );

        let summary =
            compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

        assert_eq!(summary.dimensions[0].improvement_rate, DEFAULT_IMPROVEMENT_THRESHOLD);
        assert!(summary.meets_threshold());
    }
}
