use super::effect::*;
use super::model::*;
use serde::Serialize;
use std::collections::BTreeMap;

/* ------------------------------------------------------------------ */
/* History review (R3): chronological baseline/post pairing            */
/* ------------------------------------------------------------------ */

/// One completed baseline→post evaluation run, ready for the history view
/// and the batch export (records without both phases are not runs).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectHistoryEntry {
    pub experiment_run_id: Option<String>,
    pub subject_id: String,
    pub baseline_record_id: String,
    pub post_record_id: String,
    pub baseline_created_at: String,
    pub post_created_at: String,
    pub scale_id: String,
    pub emotion: Option<String>,
    /// Wizard condition of the run (R6); `None` on legacy pre-R6 rows, which
    /// consumers treat as the regulation condition of the old flow.
    pub condition: Option<String>,
    pub duration_minutes: Option<i64>,
    pub regulation_skipped: bool,
    /// EEG recording session of the run (post leg first, baseline fallback).
    /// False when the mean was computed over unmarked legacy records.
    pub measured_only: bool,
    pub mean_improvement_rate: Option<f64>,
    pub meets_threshold: bool,
    pub dimensions: Vec<RegulationDimensionImprovement>,
}

/// Pairs records into evaluation runs by walking them chronologically per
/// subject: each post record pairs with the most recent unmatched baseline
/// of the same subject and the same wizard condition, and a fresh baseline
/// supersedes a dangling one. Records are expected in `list_scale_records`
/// order (created_at ASC); subjects are keyed by their id, with unbound
/// records grouped under "". Conditions are keyed by their raw stored value
/// (`""` for legacy NULL rows), so a post never consumes a baseline saved
/// under another condition and legacy rows only pair among themselves.
pub fn build_effect_history(records: &[ScaleRecord]) -> Vec<EffectHistoryEntry> {
    let mut pending_baselines: BTreeMap<(String, String, Option<String>), ScaleRecord> =
        BTreeMap::new();
    let mut entries = Vec::new();

    for record in records {
        let subject_key = record.subject_id.clone().unwrap_or_default();
        let condition_key = record.condition.clone().unwrap_or_default();
        let pair_key = (
            subject_key.clone(),
            condition_key,
            record.experiment_run_id.clone(),
        );

        match record.phase.as_str() {
            PHASE_BASELINE => {
                pending_baselines.insert(pair_key, record.clone());
            }
            PHASE_POST => {
                let Some(baseline) = pending_baselines.remove(&pair_key) else {
                    continue;
                };

                // A corrupt dimension payload fails loudly elsewhere; here it
                // only drops one run from the review instead of the whole list.
                if let Ok(summary) = compute_regulation_effect_summary(&baseline, record) {
                    entries.push(EffectHistoryEntry {
                        experiment_run_id: record.experiment_run_id.clone(),
                        subject_id: subject_key.clone(),
                        baseline_record_id: baseline.id,
                        post_record_id: record.id.clone(),
                        baseline_created_at: baseline.created_at,
                        post_created_at: record.created_at.clone(),
                        scale_id: record.scale_id.clone(),
                        emotion: record.emotion.clone().or_else(|| baseline.emotion.clone()),
                        condition: record
                            .condition
                            .clone()
                            .or_else(|| baseline.condition.clone()),
                        duration_minutes: record.duration_minutes.or(baseline.duration_minutes),
                        regulation_skipped: record.regulation_skipped
                            || baseline.regulation_skipped,
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

/// The condition a run belongs to for grouping purposes: an explicit
/// `natural_recovery` marks the baseline condition, everything else (explicit
/// `regulation` and legacy `NULL` rows alike) is the regulation condition of
/// the same flow.
pub fn effective_condition(condition: Option<&str>) -> &'static str {
    match condition {
        Some(CONDITION_NATURAL_RECOVERY) => CONDITION_NATURAL_RECOVERY,
        _ => CONDITION_REGULATION,
    }
}

/// Collapses the full history to each subject-emotion-condition triple's most
/// recent run for the batch export: the acceptance outline judges the
/// regulation condition against the natural-recovery baseline condition per
/// subject and emotion, so one row survives per (subject, emotion, condition)
/// combination (legacy NULL rows group with explicit `regulation` runs). The
/// result is ordered by subject id, emotion, and condition for stable output.
pub fn latest_entry_per_subject_emotion_condition(
    entries: &[EffectHistoryEntry],
) -> Vec<EffectHistoryEntry> {
    let mut latest: BTreeMap<(String, Option<String>, String), EffectHistoryEntry> =
        BTreeMap::new();

    for entry in entries {
        // Entries arrive chronologically, so later ones overwrite earlier
        // ones within the same (subject, emotion, condition) triple.
        latest.insert(
            (
                entry.subject_id.clone(),
                entry.emotion.clone(),
                effective_condition(entry.condition.as_deref()).to_string(),
            ),
            entry.clone(),
        );
    }

    latest.into_values().collect()
}

/* ------------------------------------------------------------------ */
/* Cross-condition comparison (R6, 大纲 6.2)                            */
/* ------------------------------------------------------------------ */
