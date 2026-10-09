use super::model::*;
use super::queries::parse_dimension_scores;

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

    if let (Some(baseline_subject), Some(post_subject)) = (&baseline.subject_id, &post.subject_id) {
        if baseline_subject.trim() != post_subject.trim() {
            return Err("Baseline and post records belong to different subjects.".to_string());
        }
    }

    let baseline_scores = parse_dimension_scores(&baseline.dimension_scores)?;
    let post_scores = parse_dimension_scores(&post.dimension_scores)?;

    // R4 (F1): when both records mark which dimensions were actually
    // measured, restrict the comparison to keys marked on both sides so a
    // placeholder-filled dimension cannot dilute the mean. With any unmarked
    // (legacy) side, keep the historical stored-key comparison and say so via
    // `measured_only`.
    let measured_only =
        baseline.measured_dimensions.is_some() && post.measured_dimensions.is_some();

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
