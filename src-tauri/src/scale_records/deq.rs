use super::model::{SaveScaleRecordInput, ScaleRecord, PHASE_BASELINE, PHASE_POST};
use super::queries::parse_dimension_scores;
use serde::Serialize;

pub const DEQ_SCALE_ID: &str = "deq_zh_state_12_v1";
pub const PHASE_PRE_INDUCTION: &str = "pre_induction";
pub const DEQ_ITEMS: [(&str, [&str; 4]); 3] = [
    ("anxiety", ["dread", "anxiety", "worry", "nervous"]),
    ("sadness", ["sad", "empty", "grief", "lonely"]),
    ("fear", ["scared", "panic", "terror", "fear"]),
];

pub fn validate_deq(input: &SaveScaleRecordInput) -> Result<(), String> {
    let items = input
        .raw_answers
        .get("deq")
        .and_then(|v| v.as_object())
        .filter(|items| items.len() == 12)
        .ok_or("DEQ requires twelve item responses.")?;
    if input.raw_answers["timeframe"] != "now" || input.dimension_scores.len() != DEQ_ITEMS.len() {
        return Err("Invalid DEQ timeframe or dimensions.".into());
    }
    for (dimension, keys) in DEQ_ITEMS {
        let mut total = 0;
        for key in keys {
            total += items
                .get(key)
                .and_then(|v| v.as_u64())
                .filter(|v| (1..=7).contains(v))
                .ok_or("Each DEQ response must be an integer from 1 to 7.")?;
        }
        if input.dimension_scores.get(dimension) != Some(&(total as f64 / 4.0)) {
            return Err("DEQ dimension score does not match the four item responses.".into());
        }
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmotionChange {
    pub dimension: String,
    pub pre_induction: f64,
    pub baseline: f64,
    pub post: f64,
    pub induction_change: f64,
    pub condition_change: f64,
}

pub fn emotion_changes(
    first: &ScaleRecord,
    baseline: &ScaleRecord,
    post: &ScaleRecord,
) -> Result<Vec<EmotionChange>, String> {
    if first.phase != PHASE_PRE_INDUCTION
        || baseline.phase != PHASE_BASELINE
        || post.phase != PHASE_POST
        || [first, baseline, post].iter().any(|r| {
            r.scale_id != DEQ_SCALE_ID
                || r.user_id != first.user_id
                || r.subject_id != first.subject_id
                || r.condition != first.condition
                || r.emotion != first.emotion
        })
    {
        return Err("DEQ requires three matching measurements from the same experiment.".into());
    }
    let scores = [first, baseline, post].map(|r| parse_dimension_scores(&r.dimension_scores));
    let [a, b, c] = scores;
    let (a, b, c) = (a?, b?, c?);
    DEQ_ITEMS
        .iter()
        .map(|(dim, _)| {
            let values = [&a, &b, &c].map(|s| {
                s.get(*dim)
                    .copied()
                    .filter(|v| (1.0..=7.0).contains(v) && (v * 4.0).fract() == 0.0)
                    .ok_or("Invalid stored DEQ dimension score.")
            });
            let [t0, t1, t2] = values;
            let (pre_induction, baseline, post) = (t0?, t1?, t2?);
            Ok(EmotionChange {
                dimension: dim.to_string(),
                pre_induction,
                baseline,
                post,
                induction_change: baseline - pre_induction,
                condition_change: post - baseline,
            })
        })
        .collect()
}

pub fn export_deq(
    first: &ScaleRecord,
    baseline: &ScaleRecord,
    post: &ScaleRecord,
    csv: bool,
) -> Result<String, String> {
    use super::report::{csv_field, CSV_BOM};
    let changes = emotion_changes(first, baseline, post)?;
    let exported_at = chrono::Utc::now().to_rfc3339();
    if csv {
        let mut lines = vec!["subject_id,scale_id,emotion,condition,duration_minutes,regulation_skipped,dimension,pre_induction,baseline,post,induction_change,condition_change,pre_induction_record_id,baseline_record_id,post_record_id,pre_induction_created_at,baseline_created_at,post_created_at,exported_at".to_string()];
        for change in changes {
            lines.push(
                [
                    csv_field(post.subject_id.as_deref().unwrap_or("")),
                    DEQ_SCALE_ID.to_owned(),
                    csv_field(post.emotion.as_deref().unwrap_or("")),
                    csv_field(post.condition.as_deref().unwrap_or("")),
                    post.duration_minutes
                        .map(|v| v.to_string())
                        .unwrap_or_default(),
                    post.regulation_skipped.to_string(),
                    change.dimension,
                    change.pre_induction.to_string(),
                    change.baseline.to_string(),
                    change.post.to_string(),
                    change.induction_change.to_string(),
                    change.condition_change.to_string(),
                    first.id.clone(),
                    baseline.id.clone(),
                    post.id.clone(),
                    first.created_at.clone(),
                    baseline.created_at.clone(),
                    post.created_at.clone(),
                    exported_at.clone(),
                ]
                .join(","),
            );
        }
        return Ok(format!("{CSV_BOM}{}", lines.join("\r\n")));
    }
    serde_json::to_string_pretty(&serde_json::json!({
        "scaleId":DEQ_SCALE_ID, "subjectId":post.subject_id, "emotion":post.emotion, "condition":post.condition,
        "durationMinutes":post.duration_minutes, "regulationSkipped":post.regulation_skipped,
        "preInductionRecordId":first.id, "baselineRecordId":baseline.id, "postRecordId":post.id,
        "preInductionCreatedAt":first.created_at,"baselineCreatedAt":baseline.created_at,"postCreatedAt":post.created_at,
        "preInductionRawAnswers":first.raw_answers.value()?,"baselineRawAnswers":baseline.raw_answers.value()?,
        "postRawAnswers":post.raw_answers.value()?,"emotionChanges":changes,"exportedAt":exported_at
    })).map_err(|e| e.to_string())
}
