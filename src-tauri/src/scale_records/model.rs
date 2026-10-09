use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Phases of the emotion-regulation evaluation loop: a scale answered before
/// a regulation activity (`baseline`) and again afterwards (`post`).
pub const PHASE_BASELINE: &str = "baseline";
pub const PHASE_POST: &str = "post";

/// Wizard condition of the run that produced a record (R6): `natural_recovery`
/// is the baseline condition (诱发后不调控、自然恢复), `regulation` is the
/// intervention condition. `NULL` marks pre-R6 rows saved by the legacy flow
/// (no induction step, always a regulation leg) - consumers treat those as the
/// regulation condition and surface a legacy note.
pub const CONDITION_NATURAL_RECOVERY: &str = "natural_recovery";
pub const CONDITION_REGULATION: &str = "regulation";

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
    /// Wizard condition of this run (R6): `natural_recovery` or `regulation`;
    /// `None` on standalone gate submissions and legacy payloads.
    #[serde(default)]
    pub condition: Option<String>,
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
    /// Experiment run associated with this measurement.
    #[serde(default)]
    pub experiment_run_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaleRecord {
    pub experiment_run_id: Option<String>,
    pub id: String,
    pub user_id: String,
    pub subject_id: Option<String>,
    pub scale_id: String,
    pub phase: String,
    pub dimension_scores: serde_json::Value,
    /// Stored answers JSON, parsed on demand via [`RawAnswers::value`] (the
    /// history/export scans never read it, so it is not paid per row).
    pub raw_answers: RawAnswers,
    pub created_at: String,
    pub emotion: Option<String>,
    pub condition: Option<String>,
    pub duration_minutes: Option<i64>,
    pub regulation_skipped: bool,
    pub measured_dimensions: Option<Vec<String>>,
}

/// Lazily parsed `raw_answers` payload of a scale record.
///
/// Row loading keeps the stored JSON text verbatim so the history and export
/// scans (`build_effect_history`, `compute_condition_effect_comparison`) never
/// pay the per-row `serde_json` parse — nothing in them reads the answers.
/// The structured value is built on demand where it is actually consumed:
/// the single-pair export report and the serialized IPC payloads.
#[derive(Debug, Clone)]
pub struct RawAnswers(pub(crate) String);

impl RawAnswers {
    /// Parses the stored JSON strictly on demand: like `dimension_scores`, a
    /// corrupt payload must surface instead of silently degrading to `{}`.
    pub fn value(&self) -> Result<serde_json::Value, String> {
        serde_json::from_str(&self.0).map_err(|_| "Failed to parse stored raw answers.".to_string())
    }
}

// Compares the parsed payloads so records whose stored text differs only in
// whitespace or key order still compare equal, like the old eager field.
impl PartialEq for RawAnswers {
    fn eq(&self, other: &Self) -> bool {
        self.value() == other.value()
    }
}

// Serializes exactly like the old eager `serde_json::Value` field: parse,
// then let the value serialize, keeping every IPC payload identical.
impl Serialize for RawAnswers {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self.value() {
            Ok(value) => value.serialize(serializer),
            Err(message) => Err(serde::ser::Error::custom(message)),
        }
    }
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
            .is_some_and(|mean| mean >= threshold)
    }
}
