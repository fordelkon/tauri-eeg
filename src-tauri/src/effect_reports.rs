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
    /// `single` exports one baseline/post pair; `batch` writes every subject's
    /// most recent evaluation as CSV; `comparison` writes the cross-condition
    /// comparison of one subject+emotion (R7).
    kind: String,
    /// `json` or `csv`; single/comparison default to json, batch is always csv.
    format: Option<String>,
    /// Absolute destination chosen by the user through the save dialog.
    pub(crate) path: String,
    baseline_record_id: Option<String>,
    post_record_id: Option<String>,
    /// Subject binding of the comparison export (kind = `comparison`).
    #[serde(default)]
    subject_id: Option<String>,
    /// Target emotion of the comparison export (kind = `comparison`).
    #[serde(default)]
    emotion: Option<String>,
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
    // Batch is CSV-only; an explicit csv on single switches its format.
    let format = if input.kind == "batch" {
        "csv".to_string()
    } else {
        input
            .format
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("json")
            .to_string()
    };

    match input.kind.trim() {
        "single" => {
            let baseline_id = required_id("Baseline", input.baseline_record_id.as_ref())?;
            let post_id = required_id("Post", input.post_record_id.as_ref())?;

            let baseline = scale_records::get_scale_record(conn, &baseline_id)?;
            let post = scale_records::get_scale_record(conn, &post_id)?;
            experiment::report::require_same_run(conn, &baseline.id, &post.id)?;
            let report = scale_records::build_single_effect_report(&baseline, &post)?;

            if format == "csv" {
                Ok(scale_records::build_single_effect_report_csv(&report))
            } else {
                serde_json::to_string_pretty(&report)
                    .map_err(|_| "Failed to serialize the report.".to_string())
            }
        }
        "batch" => {
            let records = scale_records::list_scale_records(conn, None, None)?;
            let records = experiment::report::eligible_records(conn, records)?;
            let history = scale_records::build_effect_history(&records);

            Ok(scale_records::build_batch_effect_report_csv(
                &scale_records::latest_entry_per_subject_emotion_condition(&history),
            ))
        }
        "comparison" => {
            let subject_id = required_field("Subject id", input.subject_id.as_ref())?;
            let emotion = required_field("Emotion", input.emotion.as_ref())?;

            // Subject pushdown (same safety argument as
            // compute_condition_effect): the comparison rejects entries whose
            // subject differs from this required, non-blank target.
            let records = scale_records::list_scale_records(conn, Some(subject_id.as_str()), None)?;
            let records = experiment::report::eligible_records(conn, records)?;
            // 大纲 6.3 步骤 5: the exported document carries both legs'
            // trace, the per-dimension inputs, the verdict, and the frozen
            // formula statement so the calculation can be re-derived.
            let comparison = scale_records::compute_condition_effect_comparison(
                &records,
                &subject_id,
                &emotion,
            )?;
            let report = scale_records::build_condition_comparison_report(&comparison);

            if format == "csv" {
                Ok(scale_records::build_condition_comparison_report_csv(
                    &report,
                ))
            } else {
                serde_json::to_string_pretty(&report)
                    .map_err(|_| "Failed to serialize the report.".to_string())
            }
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

fn required_field(label: &str, value: Option<&String>) -> Result<String, String> {
    value
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{label} is required."))
}
