use super::{
    emotion_changes, EmotionChange, ScaleRecord, DEQ_SCALE_ID, PHASE_BASELINE, PHASE_POST,
    PHASE_PRE_INDUCTION,
};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectHistoryEntry {
    pub emotion_changes: Vec<EmotionChange>,
    pub pre_induction_record_id: String,
    pub experiment_run_id: String,
    pub subject_id: String,
    pub baseline_record_id: String,
    pub post_record_id: String,
    pub baseline_created_at: String,
    pub post_created_at: String,
    pub scale_id: String,
    pub emotion: Option<String>,
    pub condition: Option<String>,
    pub duration_minutes: Option<i64>,
    pub regulation_skipped: bool,
}

/// Keep the three saved measurements together using their experiment run ID.
pub fn build_effect_history(records: &[ScaleRecord]) -> Vec<EffectHistoryEntry> {
    let mut runs: BTreeMap<&str, BTreeMap<&str, &ScaleRecord>> = BTreeMap::new();
    for record in records.iter().filter(|r| r.scale_id == DEQ_SCALE_ID) {
        if let Some(run) = record.experiment_run_id.as_deref() {
            runs.entry(run).or_default().insert(&record.phase, record);
        }
    }
    let mut entries: Vec<_> = runs
        .into_iter()
        .filter_map(|(run, phases)| {
            let first = phases.get(PHASE_PRE_INDUCTION)?;
            let baseline = phases.get(PHASE_BASELINE)?;
            let post = phases.get(PHASE_POST)?;
            Some(EffectHistoryEntry {
                emotion_changes: emotion_changes(first, baseline, post).ok()?,
                experiment_run_id: run.to_owned(),
                subject_id: post.subject_id.clone()?,
                pre_induction_record_id: first.id.clone(),
                baseline_record_id: baseline.id.clone(),
                post_record_id: post.id.clone(),
                baseline_created_at: baseline.created_at.clone(),
                post_created_at: post.created_at.clone(),
                scale_id: post.scale_id.clone(),
                emotion: post.emotion.clone(),
                condition: post.condition.clone(),
                duration_minutes: post.duration_minutes,
                regulation_skipped: post.regulation_skipped,
            })
        })
        .collect();
    entries.sort_by(|a, b| a.post_created_at.cmp(&b.post_created_at));
    entries
}

/// Input history is ordered by completion time.
pub fn latest_entry_per_subject_emotion_condition(
    entries: &[EffectHistoryEntry],
) -> Vec<EffectHistoryEntry> {
    let mut latest = BTreeMap::new();
    for entry in entries {
        latest.insert(
            (&entry.subject_id, &entry.emotion, &entry.condition),
            entry.clone(),
        );
    }
    latest.into_values().collect()
}
