use super::comparison::*;
use super::effect::*;
use super::history::*;
use super::model::*;
use chrono::Utc;
use serde::Serialize;

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
    /// Wizard condition of the exported run; `None` on legacy pre-R6 rows
    /// (rendered as "legacy" in the CSV).
    pub condition: Option<String>,
    pub duration_minutes: Option<i64>,
    pub regulation_skipped: bool,
    pub baseline_record_id: String,
    pub post_record_id: String,
    pub baseline_created_at: String,
    pub post_created_at: String,
    /// Raw item scores of the baseline leg (kept JSON-shaped so the single
    /// report stays self-contained and auditable; the CSV stays flat and
    /// deliberately omits them - embedded JSON would need quoting/escaping
    /// that breaks spreadsheet import).
    pub baseline_raw_answers: serde_json::Value,
    /// Raw item scores of the post leg; same JSON-vs-CSV tradeoff as above.
    pub post_raw_answers: serde_json::Value,
    /// EEG recording session of the run (post leg first, baseline fallback).
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
    let condition = post
        .condition
        .clone()
        .or_else(|| baseline.condition.clone());
    // Read before the fields below are moved out of the summary.
    let meets_threshold = summary.meets_threshold();

    Ok(SingleEffectReport {
        exported_at: Utc::now().to_rfc3339(),
        subject_id: summary.subject_id,
        emotion_label: emotion.as_deref().map(emotion_label),
        emotion,
        condition,
        duration_minutes: post.duration_minutes.or(baseline.duration_minutes),
        regulation_skipped: post.regulation_skipped || baseline.regulation_skipped,
        baseline_record_id: baseline.id.clone(),
        post_record_id: post.id.clone(),
        baseline_created_at: baseline.created_at.clone(),
        post_created_at: post.created_at.clone(),
        // The single consumer of the raw answers: parsed here on demand, with
        // the same strictness (and error message) the eager load had.
        baseline_raw_answers: baseline.raw_answers.value()?,
        post_raw_answers: post.raw_answers.value()?,
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

pub(crate) const CSV_BOM: &str = "\u{FEFF}";

/// One row per comparable dimension with the run's meta columns repeated,
/// so the file stays flat and importable without section parsing.
pub fn build_single_effect_report_csv(report: &SingleEffectReport) -> String {
    let header = [
        "subject_id",
        "emotion",
        "condition",
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
                // NULL conditions are pre-R6 rows of the old regulation flow.
                csv_field(report.condition.as_deref().unwrap_or("legacy")),
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

/// Batch summary: each subject-emotion-condition triple's most recent
/// evaluation on one row (legacy NULL conditions render as "legacy").
pub fn build_batch_effect_report_csv(entries: &[EffectHistoryEntry]) -> String {
    let header = [
        "subject_id",
        "emotion",
        "condition",
        "duration_minutes",
        "regulation_skipped",
        "mean_improvement_rate",
        "threshold",
        "meets_threshold",
        "dimension_count",
        "measured_only",
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
                // NULL conditions are pre-R6 rows of the old regulation flow.
                csv_field(entry.condition.as_deref().unwrap_or("legacy")),
                entry
                    .duration_minutes
                    .map_or(String::new(), |minutes| minutes.to_string()),
                entry.regulation_skipped.to_string(),
                format_optional_number(entry.mean_improvement_rate),
                DEFAULT_IMPROVEMENT_THRESHOLD.to_string(),
                entry.meets_threshold.to_string(),
                entry.dimensions.len().to_string(),
                entry.measured_only.to_string(),
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

/* ------------------------------------------------------------------ */
/* Cross-condition comparison export (R7, 大纲 6.3 步骤 5)              */
/* ------------------------------------------------------------------ */

/// Formula statement embedded in the comparison export so the document
/// carries its own calculation basis (大纲 B-1 冻结项，默认口径，测试前可换).
pub const CONDITION_COMPARISON_FORMULA: &str =
    "(B_post - T_post) / B_post，B_post 为基线条件（自然恢复）post 分，T_post 为调控条件 post 分（大纲 B-1 冻结项，默认口径，测试前可换）";

/// Cross-condition comparison report document (JSON export shape and CSV row
/// source): both legs' full trace, the per-dimension inputs and rates, the
/// mean, the threshold verdict, and the formula statement - enough to
/// reconstruct the calculation by hand (大纲 6.3 步骤 5).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConditionComparisonReport {
    pub exported_at: String,
    pub subject_id: String,
    pub emotion: Option<String>,
    pub emotion_label: Option<String>,
    /// 计算口径说明 (R7): the frozen default formula with its outline source.
    pub formula: String,
    pub threshold: f64,
    pub natural_recovery_leg: ConditionComparisonLeg,
    pub regulation_leg: ConditionComparisonLeg,
    pub dimensions: Vec<ConditionDimensionComparison>,
    pub mean_improvement_rate: Option<f64>,
    pub meets_threshold: bool,
    /// False when either leg's in-run mean covered unmarked legacy records.
    pub measured_only: bool,
}

pub fn build_condition_comparison_report(
    comparison: &ConditionEffectComparison,
) -> ConditionComparisonReport {
    ConditionComparisonReport {
        exported_at: Utc::now().to_rfc3339(),
        subject_id: comparison.subject_id.clone(),
        emotion_label: comparison.emotion.as_deref().map(emotion_label),
        emotion: comparison.emotion.clone(),
        formula: CONDITION_COMPARISON_FORMULA.to_string(),
        threshold: DEFAULT_IMPROVEMENT_THRESHOLD,
        natural_recovery_leg: comparison.natural_recovery_leg.clone(),
        regulation_leg: comparison.regulation_leg.clone(),
        dimensions: comparison.dimensions.clone(),
        mean_improvement_rate: comparison.mean_improvement_rate,
        meets_threshold: comparison.meets_threshold,
        measured_only: comparison.measured_only,
    }
}

/// One row per compared dimension with the legs' meta columns repeated, same
/// flat style as the single-run report CSV.
pub fn build_condition_comparison_report_csv(report: &ConditionComparisonReport) -> String {
    let header = [
        "subject_id",
        "emotion",
        "dimension",
        "dimension_label",
        "natural_recovery_post",
        "regulation_post",
        "improvement_rate",
        "mean_improvement_rate",
        "threshold",
        "meets_threshold",
        "measured_only",
        "natural_recovery_duration_minutes",
        "regulation_duration_minutes",
        "regulation_skipped",
        "natural_recovery_post_record_id",
        "regulation_post_record_id",
        "natural_recovery_post_created_at",
        "regulation_post_created_at",
        "formula",
        "exported_at",
    ]
    .join(",");

    let rows = report
        .dimensions
        .iter()
        .map(|dimension| {
            [
                csv_field(&report.subject_id),
                csv_field(report.emotion.as_deref().unwrap_or("")),
                csv_field(&dimension.dimension),
                csv_field(&dimension_label(&dimension.dimension)),
                dimension.natural_recovery_post.to_string(),
                dimension.regulation_post.to_string(),
                dimension.improvement_rate.to_string(),
                format_optional_number(report.mean_improvement_rate),
                report.threshold.to_string(),
                report.meets_threshold.to_string(),
                report.measured_only.to_string(),
                report
                    .natural_recovery_leg
                    .duration_minutes
                    .map_or(String::new(), |minutes| minutes.to_string()),
                report
                    .regulation_leg
                    .duration_minutes
                    .map_or(String::new(), |minutes| minutes.to_string()),
                report.regulation_leg.regulation_skipped.to_string(),
                csv_field(&report.natural_recovery_leg.post_record_id),
                csv_field(&report.regulation_leg.post_record_id),
                csv_field(&report.natural_recovery_leg.post_created_at),
                csv_field(&report.regulation_leg.post_created_at),
                csv_field(&report.formula),
                csv_field(&report.exported_at),
            ]
            .join(",")
        })
        .collect::<Vec<_>>();

    let mut lines = vec![header];
    lines.extend(rows);

    format!("{CSV_BOM}{}", lines.join("\r\n"))
}
