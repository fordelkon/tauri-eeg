use super::history::*;
use super::model::*;
use serde::Serialize;

/// Per-dimension improvement of the regulation condition relative to the
/// natural-recovery (baseline) condition, computed on each condition's post
/// scores: `(B_post - T_post) / B_post` where B_post is the natural-recovery
/// run's post score and T_post the regulation run's post score.
///
/// Formula source: 大纲 B-1 冻结项，默认口径，测试前可换。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConditionDimensionComparison {
    pub dimension: String,
    /// B_post: post score of the natural-recovery (baseline) condition run.
    pub natural_recovery_post: f64,
    /// T_post: post score of the regulation condition run.
    pub regulation_post: f64,
    pub improvement_rate: f64,
}

/// One condition's run feeding the cross-condition comparison: the full
/// trace of both legs (record ids, timestamps, condition, EEG link, basis
/// flags) so the result card and the export document stay auditable (大纲
/// 6.3 步骤 5 - 配对记录与计算过程可复核).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConditionComparisonLeg {
    pub experiment_run_id: Option<String>,
    /// Wizard condition of the run (`natural_recovery` / `regulation`); both
    /// legs carry an explicit value because legacy NULL runs never enter a
    /// comparison pair (大纲 6.2 诱发后口径).
    pub condition: String,
    pub emotion: Option<String>,
    pub baseline_record_id: String,
    pub post_record_id: String,
    pub baseline_created_at: String,
    pub post_created_at: String,
    pub scale_id: String,
    pub duration_minutes: Option<i64>,
    pub regulation_skipped: bool,
    /// False when this leg's in-run mean covered unmarked legacy records.
    pub measured_only: bool,
}

/// Cross-condition regulation effect for one subject+emotion: how much better
/// the regulation condition's final state is than the natural-recovery
/// condition's, dimension by dimension plus the threshold verdict.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConditionEffectComparison {
    pub subject_id: String,
    pub emotion: Option<String>,
    /// Trace of the natural-recovery run feeding B_post.
    pub natural_recovery_leg: ConditionComparisonLeg,
    /// Trace of the regulation run feeding T_post.
    pub regulation_leg: ConditionComparisonLeg,
    pub dimensions: Vec<ConditionDimensionComparison>,
    pub mean_improvement_rate: Option<f64>,
    pub meets_threshold: bool,
    /// True when both sides' means covered only dimensions marked as measured;
    /// false = at least one legacy run compared over all stored keys.
    pub measured_only: bool,
}

/// Message shared by every legacy-leg rejection: legacy rows predate the R6
/// induction step, so their post scores are not 诱发后 measurements and pairing
/// them would silently break the 大纲 6.2 comparison basis.
fn legacy_leg_rejection(leg: &str) -> String {
    format!(
        "{leg}来自旧流程（legacy 记录，无情绪诱发步），不满足大纲 6.2 诱发后测量口径，不能参与跨条件对比。请用当前 6 步流程为该被试同情绪完成该条件的完整评价。"
    )
}

fn comparison_leg(condition: &str, entry: &EffectHistoryEntry) -> ConditionComparisonLeg {
    ConditionComparisonLeg {
        experiment_run_id: entry.experiment_run_id.clone(),
        condition: condition.to_string(),
        emotion: entry.emotion.clone(),
        baseline_record_id: entry.baseline_record_id.clone(),
        post_record_id: entry.post_record_id.clone(),
        baseline_created_at: entry.baseline_created_at.clone(),
        post_created_at: entry.post_created_at.clone(),
        scale_id: entry.scale_id.clone(),
        duration_minutes: entry.duration_minutes,
        regulation_skipped: entry.regulation_skipped,
        measured_only: entry.measured_only,
    }
}

/// Compares the regulation condition's run against the natural-recovery
/// (baseline) condition's run (大纲 6.2: 调控条件相对基线条件的改善).
///
/// Both legs must carry an explicit condition value (legacy NULL runs from the
/// pre-R6 flow never enter the pair - their post scores were measured without
/// the induction step) and the same scale id (same dimension semantics).
/// Dimensions missing on either side are skipped (维度交集); a zero B_post
/// makes the rate undefined and the dimension is skipped, mirroring the
/// in-run pairing strategy. The mean covers only comparable dimensions and is
/// `None` when none remain.
pub fn build_condition_comparison(
    natural_recovery: &EffectHistoryEntry,
    regulation: &EffectHistoryEntry,
) -> Result<ConditionEffectComparison, String> {
    if natural_recovery.subject_id.trim() != regulation.subject_id.trim() {
        return Err("The two condition runs belong to different subjects.".to_string());
    }

    // 大纲 6.2 requires both legs to be measured after the induction step;
    // legacy NULL-condition runs are pre-R6 rows and must not enter the pair.
    if regulation.condition.is_none() {
        return Err(legacy_leg_rejection("调控腿"));
    }
    if natural_recovery.condition.is_none() {
        return Err(legacy_leg_rejection("基线条件腿"));
    }
    if natural_recovery.scale_id != regulation.scale_id {
        return Err(format!(
            "两条件 run 使用的量表不一致（基线条件 {} 与 调控条件 {}），维度含义不同，无法跨条件对比。请确保两条件使用同一量表。",
            natural_recovery.scale_id, regulation.scale_id
        ));
    }

    let mut dimensions = Vec::new();
    for natural_dimension in &natural_recovery.dimensions {
        let Some(regulation_dimension) = regulation
            .dimensions
            .iter()
            .find(|item| item.dimension == natural_dimension.dimension)
        else {
            // Not measured by both condition runs: no comparison possible.
            continue;
        };
        // Zero B_post: the relative improvement would divide by zero, skip it.
        if natural_dimension.post == 0.0 {
            continue;
        }

        dimensions.push(ConditionDimensionComparison {
            dimension: natural_dimension.dimension.clone(),
            natural_recovery_post: natural_dimension.post,
            regulation_post: regulation_dimension.post,
            // (B_post - T_post) / B_post - 大纲 B-1 冻结项，默认口径，测试前可换。
            improvement_rate: (natural_dimension.post - regulation_dimension.post)
                / natural_dimension.post,
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
    let meets_threshold =
        mean_improvement_rate.is_some_and(|mean| mean >= DEFAULT_IMPROVEMENT_THRESHOLD);

    Ok(ConditionEffectComparison {
        subject_id: natural_recovery.subject_id.clone(),
        emotion: natural_recovery
            .emotion
            .clone()
            .or_else(|| regulation.emotion.clone()),
        natural_recovery_leg: comparison_leg(CONDITION_NATURAL_RECOVERY, natural_recovery),
        regulation_leg: comparison_leg(CONDITION_REGULATION, regulation),
        dimensions,
        mean_improvement_rate,
        meets_threshold,
        measured_only: natural_recovery.measured_only && regulation.measured_only,
    })
}

/// Cross-condition summary for one subject+emotion: pairs the latest complete
/// run of each condition and compares their post scores per dimension.
/// Legacy `NULL`-condition runs (pre-R6, no induction step) are never picked
/// as a leg - 大纲 6.2 requires both conditions measured after induction - and
/// when only such rows exist for the regulation side, the error names that
/// as the reason instead of silently dropping them. Records are expected in
/// `list_scale_records` order (created_at ASC).
pub fn compute_condition_effect_comparison(
    records: &[ScaleRecord],
    subject_id: &str,
    emotion: &str,
) -> Result<ConditionEffectComparison, String> {
    let subject_id = subject_id.trim();
    if subject_id.is_empty() {
        return Err("Subject id is required.".to_string());
    }

    let emotion = emotion.trim();
    if emotion.is_empty() {
        return Err("Emotion is required.".to_string());
    }

    let entries = build_effect_history(records);
    let mut natural_recovery: Option<&EffectHistoryEntry> = None;
    let mut regulation: Option<&EffectHistoryEntry> = None;
    // Newest legacy run of the regulation side, kept only to explain why the
    // regulation leg is missing when no explicit-condition run exists.
    let mut legacy_regulation: Option<&EffectHistoryEntry> = None;

    for entry in &entries {
        if entry.subject_id.trim() != subject_id {
            continue;
        }
        // Emotion travels post-first; runs without an emotion never match.
        if entry.emotion.as_deref().map(str::trim) != Some(emotion) {
            continue;
        }

        // Entries arrive chronologically, so the last match per condition wins.
        match entry.condition.as_deref() {
            Some(CONDITION_NATURAL_RECOVERY) => natural_recovery = Some(entry),
            Some(CONDITION_REGULATION) => regulation = Some(entry),
            // Legacy NULL rows are unusable legs (no induction step); they are
            // remembered but never selected.
            _ => legacy_regulation = Some(entry),
        }
    }

    let natural_recovery = natural_recovery.ok_or_else(|| {
        "缺少基线条件（自然恢复）的完整评价 run：同被试同情绪需要自然恢复条件与调控条件各至少一条完整记录，才能进行跨条件对比。".to_string()
    })?;
    let regulation = regulation.ok_or_else(|| {
        if legacy_regulation.is_some() {
            "缺少满足口径的调控条件完整评价 run：同被试同情绪只找到旧流程（legacy，无情绪诱发步）记录，不满足大纲 6.2 诱发后测量口径，无法参与跨条件对比。请用当前 6 步流程完成一次调控条件评价。".to_string()
        } else {
            "缺少调控条件的完整评价 run：同被试同情绪需要自然恢复条件与调控条件各至少一条完整记录，才能进行跨条件对比。".to_string()
        }
    })?;

    build_condition_comparison(natural_recovery, regulation)
}
