use super::model::*;
use chrono::Utc;
use rusqlite::{params, params_from_iter, Connection};
use std::collections::BTreeMap;
use uuid::Uuid;

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
    let condition = normalize_optional_text(input.condition.as_deref());
    if let Some(condition) = condition {
        validate_condition(condition)?;
    }
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

    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    let dimension_scores = serde_json::to_string(&input.dimension_scores)
        .map_err(|_| "Failed to serialize dimension scores.".to_string())?;
    let raw_answers = serde_json::to_string(&input.raw_answers)
        .map_err(|_| "Failed to serialize raw answers.".to_string())?;
    let measured_dimensions_json = measured_dimensions
        .as_ref()
        .map(|keys| {
            serde_json::to_string(keys)
                .map_err(|_| "Failed to serialize measured dimensions.".to_string())
        })
        .transpose()?;

    conn.execute(
        "INSERT INTO scale_records
            (id, user_id, subject_id, scale_id, phase, dimension_scores, raw_answers, created_at,
             emotion, condition, duration_minutes, regulation_skipped, measured_dimensions)
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
            condition,
            duration_minutes,
            input.regulation_skipped,
            measured_dimensions_json,
        ],
    )
    .map_err(|_| "Failed to save scale record.".to_string())?;

    Ok(ScaleRecord {
        experiment_run_id: None,
        id,
        user_id: user_id.to_string(),
        subject_id: normalize_optional_text(input.subject_id.as_deref()).map(str::to_string),
        scale_id: scale_id.to_string(),
        phase: input.phase.trim().to_string(),
        dimension_scores: serde_json::from_str(&dimension_scores)
            .map_err(|_| "Failed to re-read dimension scores.".to_string())?,
        raw_answers: RawAnswers(raw_answers.clone()),
        created_at,
        emotion: emotion.map(str::to_string),
        condition: condition.map(str::to_string),
        duration_minutes,
        regulation_skipped: input.regulation_skipped,
        measured_dimensions,
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

/// Column projection shared by every filter combination of
/// `list_scale_records` (identical for all of them).
const LIST_SCALE_RECORDS_SELECT: &str = "SELECT id, user_id, subject_id, scale_id, phase, dimension_scores, raw_answers, created_at, emotion, condition, duration_minutes, regulation_skipped, measured_dimensions FROM scale_records";

/// Builds the list query and its positional bindings: one concrete
/// `column = ?` equality per bound filter. Unlike the previous
/// `(?1 IS NULL OR subject_id = ?1) AND (?2 IS NULL OR phase = ?2)` form,
/// which defeated index use, each combination gets its own prepared statement
/// (via `prepare_cached`) whose plan can pick an index — a subject filter
/// scans `idx_scale_records_subject_created` directly in the `created_at`
/// order the query sorts by. Bindings follow clause order: subject first.
pub(crate) fn build_list_records_sql(
    subject_id: Option<&str>,
    phase: Option<&str>,
) -> (String, Vec<String>) {
    let mut sql = String::from(LIST_SCALE_RECORDS_SELECT);
    let mut clauses: Vec<&'static str> = Vec::new();
    let mut bindings: Vec<String> = Vec::new();

    if let Some(subject_id) = subject_id {
        clauses.push("subject_id = ?");
        bindings.push(subject_id.to_string());
    }
    if let Some(phase) = phase {
        clauses.push("phase = ?");
        bindings.push(phase.to_string());
    }
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    // Chronological order so a subject's baseline precedes its post record.
    sql.push_str(" ORDER BY created_at ASC");

    (sql, bindings)
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

    let (sql, bindings) = build_list_records_sql(subject_id, phase);

    let mut stmt = conn
        .prepare_cached(&sql)
        .map_err(|_| "Failed to load scale records.".to_string())?;

    let rows = stmt
        .query_map(params_from_iter(bindings.iter()), map_record_row)
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
                    emotion, condition, duration_minutes, regulation_skipped, measured_dimensions
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
        condition: row.get(9)?,
        duration_minutes: row.get(10)?,
        regulation_skipped: row.get::<_, i64>(11)? != 0,
        measured_dimensions: row.get(12)?,
    })
}

pub fn delete_scale_record(conn: &Connection, id: &str) -> Result<ScaleRecord, String> {
    let row = fetch_record_row(conn, id)?;

    if let Err(err) = conn.execute(
        "DELETE FROM experiment_scales WHERE record_id = ?1",
        params![id],
    ) {
        let msg = err.to_string();
        if !msg.contains("no such table") {
            return Err("Failed to delete scale record.".to_string());
        }
    }

    conn.execute("DELETE FROM scale_records WHERE id = ?1", params![id])
        .map_err(|_| "Failed to delete scale record.".to_string())?;

    parse_record_row(row)
}

fn validate_phase(phase: &str) -> Result<(), String> {
    if phase == PHASE_BASELINE || phase == PHASE_POST {
        return Ok(());
    }

    Err(format!(
        "Scale record phase must be '{PHASE_BASELINE}' or '{PHASE_POST}'."
    ))
}

fn validate_condition(condition: &str) -> Result<(), String> {
    if condition == CONDITION_NATURAL_RECOVERY || condition == CONDITION_REGULATION {
        return Ok(());
    }

    Err(format!(
        "Scale record condition must be '{CONDITION_NATURAL_RECOVERY}' or '{CONDITION_REGULATION}'."
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
    emotion: Option<String>,
    condition: Option<String>,
    duration_minutes: Option<i64>,
    regulation_skipped: bool,
    measured_dimensions: Option<String>,
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
        experiment_run_id: None,
        id: row.id,
        user_id: row.user_id,
        subject_id: row.subject_id,
        scale_id: row.scale_id,
        phase: row.phase,
        // Strict parse: silently degrading to an empty map would hide corrupt
        // rows from the effect computation below.
        dimension_scores: serde_json::from_str(&row.dimension_scores)
            .map_err(|_| "Failed to parse stored dimension scores.".to_string())?,
        // Kept verbatim; parsed on demand by `RawAnswers::value` only where a
        // consumer actually reads the answers (single-pair export, IPC
        // serialization), so list scans skip this per-row parse.
        raw_answers: RawAnswers(row.raw_answers),
        created_at: row.created_at,
        emotion: row.emotion,
        condition: row.condition,
        duration_minutes: row.duration_minutes,
        regulation_skipped: row.regulation_skipped,
        measured_dimensions,
    })
}

pub(crate) fn parse_dimension_scores(
    value: &serde_json::Value,
) -> Result<BTreeMap<String, f64>, String> {
    serde_json::from_value(value.clone())
        .map_err(|_| "Failed to parse dimension scores.".to_string())
}
