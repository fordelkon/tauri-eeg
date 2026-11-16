//! Effect-report export pipeline: input validation, kind/format resolution,
//! and the per-kind compute/render flows that used to live inline in the
//! `export_effect_report` command in lib.rs.

use crate::experiment;
use crate::scale_records;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Component, PathBuf};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportEffectReportInput {
    kind: String,
    /// `json` or `csv`; single defaults to json, batch is always csv.
    format: Option<String>,
    /// Absolute destination chosen by the user through the save dialog.
    pub(crate) path: String,
    baseline_record_id: Option<String>,
    post_record_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportEffectReportResult {
    pub path: String,
    pub bytes: u64,
}

/// Validates the destination chosen through the save dialog: absolute, no
/// parent traversal, and an existing parent directory — the same contract as
/// `experiment_export`, so both export commands behave identically.
pub fn resolve_export_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Export path is required.".to_string());
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() || path.components().any(|c| c == Component::ParentDir) {
        return Err("Export path must be absolute without parent traversal.".to_string());
    }

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err("Export directory does not exist.".to_string());
        }
    }

    Ok(path)
}

/// Builds the report document for the requested kind/format. Pure compute
/// over the connection: the caller owns locking, path validation, and the
/// file write.
pub fn build_report_content(
    conn: &Connection,
    input: ExportEffectReportInput,
) -> Result<String, String> {
    match input.kind.trim() {
        "single" => {
            let csv = match input.format.as_deref().map(str::trim) {
                None | Some("json" | "") => false,
                Some("csv") => true,
                _ => return Err("Unsupported single report format.".into()),
            };
            let baseline_id = required_id("Baseline", input.baseline_record_id.as_ref())?;
            let post_id = required_id("Post", input.post_record_id.as_ref())?;

            let baseline = scale_records::get_scale_record(conn, &baseline_id)?;
            let post = scale_records::get_scale_record(conn, &post_id)?;
            let first = experiment::report::pre_induction_for_pair(conn, &baseline, &post)?;
            scale_records::export_deq(&first, &baseline, &post, csv)
        }
        "batch" => {
            let records = scale_records::completed_effect_records(conn)?;
            let history = scale_records::build_effect_history(&records);

            Ok(scale_records::build_batch_effect_report_csv(
                &scale_records::latest_entry_per_subject_emotion_condition(&history),
            ))
        }
        other => Err(format!("Unknown report kind '{other}'.")),
    }
}

fn required_id(label: &str, value: Option<&String>) -> Result<String, String> {
    value
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{label} record id is required."))
}
