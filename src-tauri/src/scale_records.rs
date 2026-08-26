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
    /// Target emotion configured by the evaluation wizard; `None` on
    /// standalone gate submissions.
    pub emotion: Option<String>,
    /// Planned regulation window in minutes; `None` outside the wizard.
    pub duration_minutes: Option<i64>,
    /// True when the operator skipped part of the regulation window after an
    /// explicit confirmation (strong-duration-constraint escape hatch).
    #[serde(default)]
    pub regulation_skipped: bool,
    /// Dimension keys actually measured by this submission; `None` on legacy
    /// payloads that predate measured-dimension marking.
    #[serde(default)]
    pub measured_dimensions: Option<Vec<String>>,
    /// EEG recording session associated with this run leg (the wizard stores
    /// it on the post record so the effect verdict links back to its neural
    /// data); `None` on gate submissions and legacy rows.
    #[serde(default)]
    pub eeg_session_id: Option<String>,
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
    pub emotion: Option<String>,
    pub duration_minutes: Option<i64>,
    pub regulation_skipped: bool,
    pub measured_dimensions: Option<Vec<String>>,
    pub eeg_session_id: Option<String>,
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
///
/// When both records mark their measured dimensions (`measured_dimensions`),
/// only keys marked on **both** sides enter the mean — placeholder-filled
/// dimensions never dilute the threshold verdict. Pairs with at least one
/// unmarked (legacy) record fall back to comparing every stored key, and
/// `measured_only` is `false` so consumers can surface that degraded basis.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegulationEffectSummary {
    pub subject_id: Option<String>,
    pub dimensions: Vec<RegulationDimensionImprovement>,
    pub mean_improvement_rate: Option<f64>,
    /// True when the dimension set was restricted to keys marked as actually
    /// measured on both sides; false = legacy comparison over all stored keys.
    pub measured_only: bool,
}

impl RegulationEffectSummary {
    /// The loop target: the subject improved by at least the default
    /// threshold on average across comparable dimensions.
    pub fn meets_threshold(&self) -> bool {
        self.meets_threshold_at(DEFAULT_IMPROVEMENT_THRESHOLD)
    }

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
    .map_err(|_| "Failed to initialize scale records schema.".to_string())?;

    ensure_scale_records_columns(conn)
}

/// Appends columns introduced after the table first shipped. `CREATE TABLE IF
/// NOT EXISTS` cannot extend an existing database, so each missing column is
/// added in place; existing rows take the column default (`NULL` / `0`).
fn ensure_scale_records_columns(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(scale_records)")
        .map_err(|_| "Failed to inspect scale records schema.".to_string())?;

    let existing_columns: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|_| "Failed to inspect scale records schema.".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Failed to inspect scale records schema.".to_string())?;

    const COLUMN_ADDITIONS: [(&str, &str); 5] = [
        ("emotion", "ALTER TABLE scale_records ADD COLUMN emotion TEXT"),
        (
            "duration_minutes",
            "ALTER TABLE scale_records ADD COLUMN duration_minutes INTEGER",
        ),
        (
            "regulation_skipped",
            "ALTER TABLE scale_records ADD COLUMN regulation_skipped INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "measured_dimensions",
            "ALTER TABLE scale_records ADD COLUMN measured_dimensions TEXT",
        ),
        (
            "eeg_session_id",
            "ALTER TABLE scale_records ADD COLUMN eeg_session_id TEXT",
        ),
    ];

    for (column, alter_sql) in COLUMN_ADDITIONS {
        if !existing_columns.iter().any(|name| name == column) {
            conn.execute_batch(alter_sql).map_err(|_| {
                format!("Failed to add scale records column '{column}'.")
            })?;
        }
    }

    Ok(())
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

    let emotion = normalize_optional_text(input.emotion.as_deref());
    // Nonsense windows are dropped rather than stored (the wizard clamps
    // before saving; this guards direct API callers).
    let duration_minutes = input.duration_minutes.filter(|minutes| *minutes > 0);
    // Markers are trimmed/deduplicated so storage stays canonical even for
    // direct API callers; an explicit empty list is kept (it honestly says
    // "nothing was measured" and must not degrade to the legacy fallback).
    let measured_dimensions = input
        .measured_dimensions
        .as_ref()
        .map(|keys| normalize_dimension_keys(keys));
    let eeg_session_id = normalize_optional_text(input.eeg_session_id.as_deref());

    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    let dimension_scores =
        serde_json::to_string(&input.dimension_scores).unwrap_or_else(|_| "{}".to_string());
    let raw_answers =
        serde_json::to_string(&input.raw_answers).unwrap_or_else(|_| "{}".to_string());
    let measured_dimensions_json = measured_dimensions
        .as_ref()
        .map(|keys| serde_json::to_string(keys).unwrap_or_else(|_| "[]".to_string()));

    conn.execute(
        "INSERT INTO scale_records
            (id, user_id, subject_id, scale_id, phase, dimension_scores, raw_answers, created_at,
             emotion, duration_minutes, regulation_skipped, measured_dimensions, eeg_session_id)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            id,
            user_id,
            normalize_optional_text(input.subject_id.as_deref()),
            scale_id,
            input.phase.trim(),
            dimension_scores,
            raw_answers,
            created_at,
            emotion,
            duration_minutes,
            input.regulation_skipped,
            measured_dimensions_json,
            eeg_session_id,
        ],
    )
    .map_err(|_| "Failed to save scale record.".to_string())?;

    Ok(ScaleRecord {
        id,
        user_id: user_id.to_string(),
        subject_id: normalize_optional_text(input.subject_id.as_deref()).map(str::to_string),
        scale_id: scale_id.to_string(),
        phase: input.phase.trim().to_string(),
        dimension_scores: serde_json::from_str(&dimension_scores).unwrap_or_default(),
        raw_answers: serde_json::from_str(&raw_answers).unwrap_or_default(),
        created_at,
        emotion: emotion.map(str::to_string),
        duration_minutes,
        regulation_skipped: input.regulation_skipped,
        measured_dimensions,
        eeg_session_id: eeg_session_id.map(str::to_string),
    })
}

/// Trims each key, drops blanks, and deduplicates while preserving order.
fn normalize_dimension_keys(keys: &[String]) -> Vec<String> {
    let mut normalized: Vec<String> = Vec::with_capacity(keys.len());

    for key in keys {
        let trimmed = key.trim();

        if !trimmed.is_empty() && !normalized.iter().any(|existing| existing == trimmed) {
            normalized.push(trimmed.to_string());
        }
    }

    normalized
}

fn normalize_optional_text(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|trimmed| !trimmed.is_empty())
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
            "SELECT id, user_id, subject_id, scale_id, phase, dimension_scores, raw_answers, created_at,
                    emotion, duration_minutes, regulation_skipped, measured_dimensions, eeg_session_id
                FROM scale_records
                WHERE (?1 IS NULL OR subject_id = ?1)
                  AND (?2 IS NULL OR phase = ?2)
                ORDER BY created_at ASC",
        )
        .map_err(|_| "Failed to load scale records.".to_string())?;

    let rows = stmt
        .query_map(params![subject_id, phase], map_record_row)
        .map_err(|_| "Failed to load scale records.".to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Failed to load scale records.".to_string())?
        .into_iter()
        .map(parse_record_row)
        .collect()
}

/// Loads one scale record by id (the read side pairs two saved records for
/// the effect computation).
pub fn get_scale_record(conn: &Connection, id: &str) -> Result<ScaleRecord, String> {
    parse_record_row(fetch_record_row(conn, id)?)
}

fn fetch_record_row(conn: &Connection, id: &str) -> Result<RecordRow, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT id, user_id, subject_id, scale_id, phase, dimension_scores, raw_answers, created_at,
                    emotion, duration_minutes, regulation_skipped, measured_dimensions, eeg_session_id
                FROM scale_records WHERE id = ?1",
        )
        .map_err(|_| "Failed to load scale record.".to_string())?;

    stmt.query_row(params![id], map_record_row)
        .map_err(|_| "Scale record not found.".to_string())
}

fn map_record_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RecordRow> {
    Ok(RecordRow {
        id: row.get(0)?,
        user_id: row.get(1)?,
        subject_id: row.get(2)?,
        scale_id: row.get(3)?,
        phase: row.get(4)?,
        dimension_scores: row.get(5)?,
        raw_answers: row.get(6)?,
        created_at: row.get(7)?,
        emotion: row.get(8)?,
        duration_minutes: row.get(9)?,
        regulation_skipped: row.get::<_, i64>(10)? != 0,
        measured_dimensions: row.get(11)?,
        eeg_session_id: row.get(12)?,
    })
}

pub fn delete_scale_record(conn: &Connection, id: &str) -> Result<ScaleRecord, String> {
    let row = fetch_record_row(conn, id)?;

    conn.execute("DELETE FROM scale_records WHERE id = ?1", params![id])
        .map_err(|_| "Failed to delete scale record.".to_string())?;

    parse_record_row(row)
}

/// Compares one subject's baseline and post scale records dimension by
/// dimension. Both records must carry the expected phase; when both carry a
/// subject id they must agree (a missing id means "unknown" and passes).
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

    // R4 (F1): when both records mark which dimensions were actually
    // measured, restrict the comparison to keys marked on both sides so a
    // placeholder-filled dimension cannot dilute the mean. With any unmarked
    // (legacy) side, keep the historical stored-key comparison and say so via
    // `measured_only`.
    let measured_only = baseline.measured_dimensions.is_some() && post.measured_dimensions.is_some();

    let mut dimensions = Vec::new();
    for (dimension, baseline_value) in &baseline_scores {
        if measured_only {
            let marked_on_both_sides = |keys: &Option<Vec<String>>| {
                keys.as_ref()
                    .is_some_and(|keys| keys.iter().any(|key| key == dimension))
            };
            if !marked_on_both_sides(&baseline.measured_dimensions)
                || !marked_on_both_sides(&post.measured_dimensions)
            {
                continue;
            }
        }
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
        measured_only,
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

/* ------------------------------------------------------------------ */
/* History review (R3): chronological baseline/post pairing            */
/* ------------------------------------------------------------------ */

/// One completed baseline→post evaluation run, ready for the history view
/// and the batch export (records without both phases are not runs).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectHistoryEntry {
    pub subject_id: String,
    pub baseline_record_id: String,
    pub post_record_id: String,
    pub baseline_created_at: String,
    pub post_created_at: String,
    pub scale_id: String,
    pub emotion: Option<String>,
    pub duration_minutes: Option<i64>,
    pub regulation_skipped: bool,
    /// EEG recording session of the run (post leg first, baseline fallback).
    pub eeg_session_id: Option<String>,
    /// False when the mean was computed over unmarked legacy records.
    pub measured_only: bool,
    pub mean_improvement_rate: Option<f64>,
    pub meets_threshold: bool,
    pub dimensions: Vec<RegulationDimensionImprovement>,
}

/// Pairs records into evaluation runs by walking them chronologically per
/// subject: each post record pairs with the most recent unmatched baseline
/// of the same subject, and a fresh baseline supersedes a dangling one.
/// Records are expected in `list_scale_records` order (created_at ASC);
/// subjects are keyed by their id, with unbound records grouped under "".
pub fn build_effect_history(records: &[ScaleRecord]) -> Vec<EffectHistoryEntry> {
    let mut pending_baselines: BTreeMap<String, ScaleRecord> = BTreeMap::new();
    let mut entries = Vec::new();

    for record in records {
        let subject_key = record.subject_id.clone().unwrap_or_default();

        match record.phase.as_str() {
            PHASE_BASELINE => {
                pending_baselines.insert(subject_key, record.clone());
            }
            PHASE_POST => {
                let Some(baseline) = pending_baselines.remove(&subject_key) else {
                    continue;
                };

                // A corrupt dimension payload fails loudly elsewhere; here it
                // only drops one run from the review instead of the whole list.
                if let Ok(summary) = compute_regulation_effect_summary(&baseline, record) {
                    entries.push(EffectHistoryEntry {
                        subject_id: subject_key.clone(),
                        baseline_record_id: baseline.id,
                        post_record_id: record.id.clone(),
                        baseline_created_at: baseline.created_at,
                        post_created_at: record.created_at.clone(),
                        scale_id: record.scale_id.clone(),
                        emotion: record
                            .emotion
                            .clone()
                            .or_else(|| baseline.emotion.clone()),
                        duration_minutes: record.duration_minutes.or(baseline.duration_minutes),
                        regulation_skipped: record.regulation_skipped || baseline.regulation_skipped,
                        eeg_session_id: record
                            .eeg_session_id
                            .clone()
                            .or_else(|| baseline.eeg_session_id.clone()),
                        measured_only: summary.measured_only,
                        mean_improvement_rate: summary.mean_improvement_rate,
                        meets_threshold: summary.meets_threshold(),
                        dimensions: summary.dimensions,
                    });
                }
            }
            _ => {}
        }
    }

    entries
}

/// Collapses the full history to each subject's most recent run for the
/// batch export; the result is ordered by subject id for stable output.
pub fn latest_entry_per_subject(entries: &[EffectHistoryEntry]) -> Vec<EffectHistoryEntry> {
    let mut latest: BTreeMap<String, EffectHistoryEntry> = BTreeMap::new();

    for entry in entries {
        // Entries arrive chronologically, so later ones overwrite earlier ones.
        latest.insert(entry.subject_id.clone(), entry.clone());
    }

    latest.into_values().collect()
}

/* ------------------------------------------------------------------ */
/* Report export content (R3)                                          */
/* ------------------------------------------------------------------ */

/// Single-subject report document (JSON export shape and CSV row source).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleEffectReport {
    pub exported_at: String,
    pub subject_id: Option<String>,
    pub emotion: Option<String>,
    pub emotion_label: Option<String>,
    pub duration_minutes: Option<i64>,
    pub regulation_skipped: bool,
    pub baseline_record_id: String,
    pub post_record_id: String,
    pub baseline_created_at: String,
    pub post_created_at: String,
    /// EEG recording session of the run (post leg first, baseline fallback).
    pub eeg_session_id: Option<String>,
    /// False when the mean was computed over unmarked legacy records.
    pub measured_only: bool,
    pub threshold: f64,
    pub mean_improvement_rate: Option<f64>,
    pub meets_threshold: bool,
    pub dimensions: Vec<RegulationDimensionImprovement>,
}

pub fn build_single_effect_report(
    baseline: &ScaleRecord,
    post: &ScaleRecord,
) -> Result<SingleEffectReport, String> {
    let summary = compute_regulation_effect_summary(baseline, post)?;
    let emotion = post.emotion.clone().or_else(|| baseline.emotion.clone());
    // Read before the fields below are moved out of the summary.
    let meets_threshold = summary.meets_threshold();

    Ok(SingleEffectReport {
        exported_at: Utc::now().to_rfc3339(),
        subject_id: summary.subject_id,
        emotion_label: emotion.as_deref().map(emotion_label),
        emotion,
        duration_minutes: post.duration_minutes.or(baseline.duration_minutes),
        regulation_skipped: post.regulation_skipped || baseline.regulation_skipped,
        baseline_record_id: baseline.id.clone(),
        post_record_id: post.id.clone(),
        baseline_created_at: baseline.created_at.clone(),
        post_created_at: post.created_at.clone(),
        eeg_session_id: post
            .eeg_session_id
            .clone()
            .or_else(|| baseline.eeg_session_id.clone()),
        measured_only: summary.measured_only,
        threshold: DEFAULT_IMPROVEMENT_THRESHOLD,
        mean_improvement_rate: summary.mean_improvement_rate,
        meets_threshold,
        dimensions: summary.dimensions,
    })
}

fn emotion_label(key: &str) -> String {
    match key {
        "anxiety" => "焦虑".to_string(),
        "depression" => "抑郁".to_string(),
        "fear" => "恐惧".to_string(),
        other => other.to_string(),
    }
}

fn dimension_label(key: &str) -> String {
    match key {
        "anxiety" => "焦虑".to_string(),
        "energy" => "精力".to_string(),
        "mood" => "情绪".to_string(),
        "worry" => "担忧".to_string(),
        other => other.to_string(),
    }
}

fn format_optional_number(value: Option<f64>) -> String {
    value.map_or("—".to_string(), |number| number.to_string())
}

/// Quotes a CSV field when it contains a separator, quote, or line break;
/// embedded quotes are doubled per RFC 4180.
fn csv_field(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

const CSV_BOM: &str = "\u{FEFF}";

/// One row per comparable dimension with the run's meta columns repeated,
/// so the file stays flat and importable without section parsing.
pub fn build_single_effect_report_csv(report: &SingleEffectReport) -> String {
    let header = [
        "subject_id",
        "emotion",
        "dimension",
        "dimension_label",
        "baseline",
        "post",
        "improvement_rate",
        "mean_improvement_rate",
        "threshold",
        "meets_threshold",
        "regulation_skipped",
        "measured_only",
        "eeg_session_id",
        "baseline_created_at",
        "post_created_at",
        "exported_at",
    ]
    .join(",");

    let rows = report
        .dimensions
        .iter()
        .map(|dimension| {
            [
                csv_field(report.subject_id.as_deref().unwrap_or("")),
                csv_field(report.emotion.as_deref().unwrap_or("")),
                csv_field(&dimension.dimension),
                csv_field(&dimension_label(&dimension.dimension)),
                dimension.baseline.to_string(),
                dimension.post.to_string(),
                dimension.improvement_rate.to_string(),
                format_optional_number(report.mean_improvement_rate),
                report.threshold.to_string(),
                report.meets_threshold.to_string(),
                report.regulation_skipped.to_string(),
                report.measured_only.to_string(),
                csv_field(report.eeg_session_id.as_deref().unwrap_or("")),
                csv_field(&report.baseline_created_at),
                csv_field(&report.post_created_at),
                csv_field(&report.exported_at),
            ]
            .join(",")
        })
        .collect::<Vec<_>>();

    let mut lines = vec![header];
    lines.extend(rows);

    // BOM keeps the Chinese labels readable when the file opens in Excel.
    format!("{CSV_BOM}{}", lines.join("\r\n"))
}

/// Batch summary: every subject's most recent evaluation on one row.
pub fn build_batch_effect_report_csv(entries: &[EffectHistoryEntry]) -> String {
    let header = [
        "subject_id",
        "emotion",
        "duration_minutes",
        "regulation_skipped",
        "mean_improvement_rate",
        "threshold",
        "meets_threshold",
        "dimension_count",
        "measured_only",
        "eeg_session_id",
        "baseline_created_at",
        "post_created_at",
        "exported_at",
    ]
    .join(",");

    let exported_at = Utc::now().to_rfc3339();
    let rows = entries
        .iter()
        .map(|entry| {
            [
                csv_field(&entry.subject_id),
                csv_field(entry.emotion.as_deref().unwrap_or("")),
                entry
                    .duration_minutes
                    .map_or(String::new(), |minutes| minutes.to_string()),
                entry.regulation_skipped.to_string(),
                format_optional_number(entry.mean_improvement_rate),
                DEFAULT_IMPROVEMENT_THRESHOLD.to_string(),
                entry.meets_threshold.to_string(),
                entry.dimensions.len().to_string(),
                entry.measured_only.to_string(),
                csv_field(entry.eeg_session_id.as_deref().unwrap_or("")),
                csv_field(&entry.baseline_created_at),
                csv_field(&entry.post_created_at),
                csv_field(&exported_at),
            ]
            .join(",")
        })
        .collect::<Vec<_>>();

    let mut lines = vec![header];
    lines.extend(rows);

    format!("{CSV_BOM}{}", lines.join("\r\n"))
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
    emotion: Option<String>,
    duration_minutes: Option<i64>,
    regulation_skipped: bool,
    measured_dimensions: Option<String>,
    eeg_session_id: Option<String>,
}

fn parse_record_row(row: RecordRow) -> Result<ScaleRecord, String> {
    // Strict parse (matching dimension_scores): silently degrading a corrupt
    // marker list would hide the row's real measurement basis from the
    // effect computation below.
    let measured_dimensions = match row.measured_dimensions {
        Some(raw) => Some(
            serde_json::from_str::<Vec<String>>(&raw)
                .map_err(|_| "Failed to parse stored measured dimensions.".to_string())?,
        ),
        None => None,
    };

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
        emotion: row.emotion,
        duration_minutes: row.duration_minutes,
        regulation_skipped: row.regulation_skipped,
        measured_dimensions,
        eeg_session_id: row.eeg_session_id,
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
            emotion: Some("anxiety".to_string()),
            duration_minutes: Some(5),
            regulation_skipped: false,
            measured_dimensions: None,
            eeg_session_id: None,
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
    fn persists_measured_dimensions_and_eeg_session_id() {
        let conn = setup_conn();

        let mut input = sample_input("user-1", Some("subject-1"), PHASE_POST);
        input.measured_dimensions = Some(vec![
            " mood ".to_string(),
            "anxiety".to_string(),
            "mood".to_string(),
            "   ".to_string(),
        ]);
        input.eeg_session_id = Some("  eeg-session-77 ".to_string());

        let saved = save_scale_record(&conn, &input).expect("save record");

        // Trimmed, deduplicated, blanks dropped, order preserved.
        assert_eq!(
            saved.measured_dimensions.as_deref(),
            Some(&["mood".to_string(), "anxiety".to_string()][..])
        );
        assert_eq!(saved.eeg_session_id.as_deref(), Some("eeg-session-77"));

        let loaded = get_scale_record(&conn, &saved.id).expect("reload record");
        assert_eq!(
            loaded.measured_dimensions,
            Some(vec!["mood".to_string(), "anxiety".to_string()])
        );
        assert_eq!(loaded.eeg_session_id.as_deref(), Some("eeg-session-77"));

        let listed = list_scale_records(&conn, None, None).expect("list records");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].eeg_session_id.as_deref(), Some("eeg-session-77"));
    }

    #[test]
    fn normalizes_blank_eeg_session_and_empty_marker_lists() {
        let conn = setup_conn();

        let mut blank_markers = sample_input("user-1", None, PHASE_BASELINE);
        blank_markers.measured_dimensions = Some(vec!["   ".to_string()]);
        blank_markers.eeg_session_id = Some("   ".to_string());
        let saved = save_scale_record(&conn, &blank_markers).expect("save record");

        // An all-blank marker list still counts as explicitly empty (it must
        // not degrade to the unmarked legacy fallback), while a blank session
        // id is stored as NULL like other optional text.
        assert_eq!(saved.measured_dimensions, Some(Vec::new()));
        assert_eq!(saved.eeg_session_id, None);
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

        let summary =
            compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

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
        let summary =
            compute_regulation_effect_summary(&baseline, &post).expect("compute summary");
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
        let summary =
            compute_regulation_effect_summary(&baseline, &post).expect("compute summary");
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

        let summary =
            compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

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

        let summary =
            compute_regulation_effect_summary(&baseline, &post).expect("compute summary");

        // One unmarked side means the marker intersection would silently drop
        // data; fall back to every shared stored key instead.
        assert!(!summary.measured_only);
        assert_eq!(summary.dimensions.len(), 2);
    }

    #[test]
    fn effect_history_and_single_report_carry_eeg_session_and_basis() {
        let conn = setup_conn();

        let mut baseline = sample_input("user-1", Some("subj-link"), PHASE_BASELINE);
        baseline.dimension_scores = BTreeMap::from([("anxiety".to_string(), 80.0)]);
        baseline.measured_dimensions = Some(vec!["anxiety".to_string()]);
        baseline.eeg_session_id = Some("eeg-baseline-only".to_string());

        let mut post = sample_input("user-1", Some("subj-link"), PHASE_POST);
        post.dimension_scores = BTreeMap::from([("anxiety".to_string(), 48.0)]);
        post.measured_dimensions = Some(vec!["anxiety".to_string()]);
        post.eeg_session_id = Some("eeg-post-leg".to_string());

        let baseline = save_scale_record(&conn, &baseline).expect("save baseline");
        let post = save_scale_record(&conn, &post).expect("save post");

        let report =
            build_single_effect_report(&baseline, &post).expect("build single report");
        assert_eq!(report.eeg_session_id.as_deref(), Some("eeg-post-leg"));
        assert!(report.measured_only);

        let json = serde_json::to_value(&report).expect("serialize report");
        assert_eq!(json["eegSessionId"], serde_json::json!("eeg-post-leg"));
        assert_eq!(json["measuredOnly"], serde_json::Value::Bool(true));

        let history = build_effect_history(
            &list_scale_records(&conn, None, None).expect("list records"),
        );
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].eeg_session_id.as_deref(), Some("eeg-post-leg"));
        assert!(history[0].measured_only);

        // The summary itself reports the restricted basis too.
        let summary =
            compute_regulation_effect_summary(&baseline, &post).expect("compute summary");
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
        assert_eq!(loaded.duration_minutes, None);
        assert!(!loaded.regulation_skipped);
        // R4 columns degrade to the legacy semantics on pre-R4 rows.
        assert_eq!(loaded.measured_dimensions, None);
        assert_eq!(loaded.eeg_session_id, None);

        // The migrated table keeps accepting full saves.
        let mut saved_input = sample_input("user-1", Some("subject-new"), PHASE_BASELINE);
        saved_input.measured_dimensions = Some(vec!["anxiety".to_string()]);
        saved_input.eeg_session_id = Some("eeg-session-9".to_string());
        let saved = save_scale_record(&conn, &saved_input).expect("save after migration");
        assert_eq!(saved.emotion.as_deref(), Some("anxiety"));
        assert_eq!(saved.measured_dimensions.as_deref(), Some(&["anxiety".to_string()][..]));
        assert_eq!(saved.eeg_session_id.as_deref(), Some("eeg-session-9"));
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
            history_record(&conn, Some("s1"), PHASE_BASELINE, Some("anxiety"), false, "2026-08-01T09:00:00+00:00"),
            history_record(&conn, Some("s1"), PHASE_POST, Some("anxiety"), true, "2026-08-01T10:00:00+00:00"),
            history_record(&conn, Some("s1"), PHASE_BASELINE, Some("fear"), false, "2026-08-02T09:00:00+00:00"),
            history_record(&conn, Some("s1"), PHASE_POST, Some("fear"), false, "2026-08-02T10:00:00+00:00"),
            history_record(&conn, None, PHASE_BASELINE, None, false, "2026-08-04T09:00:00+00:00"),
            history_record(&conn, None, PHASE_POST, None, false, "2026-08-04T10:00:00+00:00"),
        ];

        let entries = build_effect_history(&records);

        // Each subject walks chronologically: post #1 pairs with baseline #1,
        // post #2 with baseline #2. The unbound pair groups under "".
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].subject_id, "s1");
        assert_eq!(
            entries[0].baseline_created_at,
            "2026-08-01T09:00:00+00:00"
        );
        assert_eq!(entries[0].post_created_at, "2026-08-01T10:00:00+00:00");
        assert_eq!(entries[0].emotion.as_deref(), Some("anxiety"));
        // The skip marker travels with the run's post record.
        assert!(entries[0].regulation_skipped);

        assert_eq!(entries[1].subject_id, "s1");
        assert_eq!(
            entries[1].baseline_created_at,
            "2026-08-02T09:00:00+00:00"
        );
        assert_eq!(entries[1].emotion.as_deref(), Some("fear"));
        assert!(!entries[1].regulation_skipped);

        assert_eq!(entries[2].subject_id, "");
        assert!(entries[2].mean_improvement_rate.is_some());
    }

    #[test]
    fn build_effect_history_prefers_the_latest_baseline_and_marks_skips() {
        let conn = setup_conn();
        let records = vec![
            history_record(&conn, Some("s2"), PHASE_BASELINE, None, false, "2026-08-01T09:00:00+00:00"),
            history_record(&conn, Some("s2"), PHASE_BASELINE, Some("depression"), false, "2026-08-02T09:00:00+00:00"),
            history_record(&conn, Some("s2"), PHASE_POST, None, true, "2026-08-02T11:00:00+00:00"),
        ];

        let entries = build_effect_history(&records);

        // A dangling earlier baseline is superseded by the newer one.
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].baseline_created_at,
            "2026-08-02T09:00:00+00:00"
        );
        // Emotion falls back to the baseline when the post has none.
        assert_eq!(entries[0].emotion.as_deref(), Some("depression"));
        assert!(entries[0].regulation_skipped);
    }

    #[test]
    fn latest_entry_per_subject_keeps_only_each_subjects_newest_run() {
        let conn = setup_conn();
        let records = vec![
            history_record(&conn, Some("s1"), PHASE_BASELINE, None, false, "2026-08-01T09:00:00+00:00"),
            history_record(&conn, Some("s1"), PHASE_POST, None, false, "2026-08-01T10:00:00+00:00"),
            history_record(&conn, Some("s2"), PHASE_BASELINE, None, false, "2026-08-02T09:00:00+00:00"),
            history_record(&conn, Some("s2"), PHASE_POST, None, false, "2026-08-02T10:00:00+00:00"),
            history_record(&conn, Some("s1"), PHASE_BASELINE, None, false, "2026-08-03T09:00:00+00:00"),
            history_record(&conn, Some("s1"), PHASE_POST, None, false, "2026-08-03T10:00:00+00:00"),
        ];

        let entries = build_effect_history(&records);
        assert_eq!(entries.len(), 3);

        let latest = latest_entry_per_subject(&entries);
        assert_eq!(latest.len(), 2);
        // Ordered by subject id for stable batch output.
        assert_eq!(latest[0].subject_id, "s1");
        assert_eq!(latest[0].post_created_at, "2026-08-03T10:00:00+00:00");
        assert_eq!(latest[1].subject_id, "s2");
        assert_eq!(latest[1].post_created_at, "2026-08-02T10:00:00+00:00");
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
        post.duration_minutes = Some(5);
        post.regulation_skipped = true;
        let post = save_scale_record(&conn, &post).expect("save post");

        let report =
            build_single_effect_report(&baseline, &post).expect("build single report");

        assert_eq!(report.subject_id.as_deref(), Some("subj-r"));
        assert_eq!(report.emotion.as_deref(), Some("anxiety"));
        assert_eq!(report.emotion_label.as_deref(), Some("焦虑"));
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
        assert_eq!(json["threshold"], serde_json::json!(DEFAULT_IMPROVEMENT_THRESHOLD));
    }

    #[test]
    fn single_report_rejects_mismatched_phases() {
        let conn = setup_conn();
        let baseline =
            save_scale_record(&conn, &sample_input("user-1", Some("s"), PHASE_BASELINE))
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
            duration_minutes: Some(3),
            regulation_skipped: true,
            baseline_record_id: "b".to_string(),
            post_record_id: "p".to_string(),
            baseline_created_at: "2026-08-26T10:00:00+00:00".to_string(),
            post_created_at: "2026-08-26T11:00:00+00:00".to_string(),
            eeg_session_id: Some("eeg-run-42".to_string()),
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
        assert!(lines[0].starts_with(
            "subject_id,emotion,dimension,dimension_label,baseline",
        ));
        assert!(lines[0].contains("measured_only,eeg_session_id,baseline_created_at"));
        assert!(lines[1].contains("\"subj, \"\"quoted\"\"\""));
        assert!(lines[1].contains(",焦虑,"));
        assert!(lines[1].contains(",true,eeg-run-42,2026-08-26T10:00:00+00:00,"));
        assert!(lines[1].ends_with(",2026-08-26T12:00:00+00:00"));
    }

    #[test]
    fn batch_csv_lists_one_row_per_subject_with_latest_results() {
        let entries = vec![
            EffectHistoryEntry {
                subject_id: "s1".to_string(),
                baseline_record_id: "b1".to_string(),
                post_record_id: "p1".to_string(),
                baseline_created_at: "2026-08-01T09:00:00+00:00".to_string(),
                post_created_at: "2026-08-01T10:00:00+00:00".to_string(),
                scale_id: "/music-regulation".to_string(),
                emotion: Some("anxiety".to_string()),
                duration_minutes: Some(5),
                regulation_skipped: false,
                eeg_session_id: Some("eeg-run-7".to_string()),
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
                subject_id: "s2".to_string(),
                baseline_record_id: "b2".to_string(),
                post_record_id: "p2".to_string(),
                baseline_created_at: "2026-08-02T09:00:00+00:00".to_string(),
                post_created_at: "2026-08-02T10:00:00+00:00".to_string(),
                scale_id: "/video-regulation".to_string(),
                emotion: None,
                duration_minutes: None,
                regulation_skipped: true,
                eeg_session_id: None,
                measured_only: false,
                mean_improvement_rate: None,
                meets_threshold: false,
                dimensions: Vec::new(),
            },
        ];

        let csv = build_batch_effect_report_csv(&entries);
        let lines: Vec<&str> = csv.trim_start_matches(CSV_BOM).split("\r\n").collect();

        assert_eq!(lines.len(), 3);
        assert!(lines[0].starts_with(
            "subject_id,emotion,duration_minutes,regulation_skipped,mean_improvement_rate,threshold,meets_threshold,dimension_count,measured_only,eeg_session_id",
        ));
        assert!(lines[1].starts_with("s1,anxiety,5,false,0.4,0.1,true,1,true,eeg-run-7,"));
        // Empty emotion and duration collapse to bare separators.
        assert!(lines[2].starts_with("s2,,,true,—,0.1,false,0,false,"));
    }
}
