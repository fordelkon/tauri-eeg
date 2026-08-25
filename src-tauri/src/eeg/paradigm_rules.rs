use serde::{Deserialize, Serialize};

use super::paradigm::{
    ParadigmEmotion, ParadigmSessionKind, TrialQuality, TrialStatus, PARADIGM_EMOTIONS,
};

/// One line of trials.jsonl and one row of the eeg_trials table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialRecord {
    pub trial_id: String,
    pub session_id: String,
    pub subject_id: String,
    pub session_run_id: String,
    pub study_session: ParadigmSessionKind,
    pub trial_index: u32,
    pub status: TrialStatus,
    pub phase: String,
    pub paradigm_emotion: ParadigmEmotion,
    pub system_emotion: Option<String>,
    pub trigger_class: u8,
    pub video_id: String,
    pub video_path: String,
    pub trigger_start_ts: Option<String>,
    pub trigger_end_ts: Option<String>,
    pub eeg_start_ts: String,
    pub eeg_end_ts: Option<String>,
    pub eeg_start_sample_index: u64,
    pub eeg_end_sample_index: Option<u64>,
    pub sample_rate_hz: u32,
    pub channel_count: usize,
    pub recording_path: String,
    pub self_report_valence: Option<u8>,
    pub self_report_arousal: Option<u8>,
    pub self_report_dominance: Option<u8>,
    pub self_report_acceptance: Option<TrialQuality>,
    pub quality: Option<TrialQuality>,
    pub label_source: Option<super::paradigm::LabelSource>,
    pub artifact_flags: Vec<String>,
    pub operator_notes: Option<String>,
    pub created_at: String,
}

impl TrialRecord {
    pub fn trial_id_for(session_run_id: &str, trial_index: u32) -> String {
        format!("{session_run_id}_t{:02}", trial_index + 1)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParadigmClassSummary {
    pub emotion: ParadigmEmotion,
    pub accepted: u32,
    pub uncertain: u32,
    pub rejected: u32,
    pub artifact_rejected: u32,
    pub interrupted: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParadigmSessionSummary {
    pub session_id: String,
    pub total_trials: u32,
    pub per_class: Vec<ParadigmClassSummary>,
    pub valence_mean: Option<f64>,
    pub arousal_mean: Option<f64>,
    pub warnings: Vec<String>,
}

const MIN_ACCEPTED_FOR_TRAINING: u32 = 3;
const RECOMMENDED_ACCEPTED: u32 = 5;

/// Suggested trial quality from the self-report scores. Mirrors the frontend
/// acceptance map; the decision order matters (own region, own boundary, other
/// region, hard rejects, then uncertain).
pub fn compute_acceptance(emotion: ParadigmEmotion, valence: u8, arousal: u8) -> TrialQuality {
    let (v, a) = (valence as i32, arousal as i32);

    if in_class_region(emotion, v, a) {
        return TrialQuality::Accepted;
    }

    if near_class_boundary(emotion, v, a) {
        return TrialQuality::Uncertain;
    }

    let in_other_region = PARADIGM_EMOTIONS
        .iter()
        .any(|other| *other != emotion && in_class_region(*other, v, a));
    if in_other_region {
        return TrialQuality::Rejected;
    }

    if hard_reject(emotion, v, a) {
        return TrialQuality::Rejected;
    }

    TrialQuality::Uncertain
}

fn in_class_region(emotion: ParadigmEmotion, v: i32, a: i32) -> bool {
    match emotion {
        ParadigmEmotion::Depression => v <= 4 && a <= 5,
        ParadigmEmotion::Anxiety => v <= 4 && a >= 6,
        ParadigmEmotion::Calm => v >= 5 && a <= 4,
        ParadigmEmotion::Happy => v >= 6 && (5..=8).contains(&a),
    }
}

fn near_class_boundary(emotion: ParadigmEmotion, v: i32, a: i32) -> bool {
    match emotion {
        ParadigmEmotion::Depression => (v <= 4 && a == 6) || (v == 5 && a <= 5),
        ParadigmEmotion::Anxiety => (v <= 4 && a == 5) || (v == 5 && a >= 6),
        ParadigmEmotion::Calm => (v == 4 && a <= 4) || (v >= 5 && a == 5),
        ParadigmEmotion::Happy => (v == 5 && (5..=8).contains(&a)) || (v >= 6 && a == 4),
    }
}

fn hard_reject(emotion: ParadigmEmotion, v: i32, a: i32) -> bool {
    match emotion {
        ParadigmEmotion::Depression => v >= 7,
        ParadigmEmotion::Anxiety => false,
        ParadigmEmotion::Calm => a >= 6 || v <= 3,
        ParadigmEmotion::Happy => v <= 4 || a >= 9,
    }
}

/// Aggregates finished trials (from the controller or the database) into the
/// training readiness summary written to training-manifest.json.
pub fn summarize_trials(session_id: &str, records: &[TrialRecord]) -> ParadigmSessionSummary {
    let per_class = PARADIGM_EMOTIONS
        .map(|emotion| ParadigmClassSummary {
            emotion,
            accepted: quality_count(records, emotion, TrialQuality::Accepted),
            uncertain: quality_count(records, emotion, TrialQuality::Uncertain),
            rejected: quality_count(records, emotion, TrialQuality::Rejected),
            artifact_rejected: quality_count(records, emotion, TrialQuality::ArtifactRejected),
            interrupted: records
                .iter()
                .filter(|record| {
                    record.paradigm_emotion == emotion && record.status == TrialStatus::Interrupted
                })
                .count() as u32,
        })
        .to_vec();

    // Only classes actually present in the session are graded: a calm-only
    // calibration run must not warn about the absent induction classes.
    let warnings = per_class
        .iter()
        .filter(|summary| {
            summary.accepted
                + summary.uncertain
                + summary.rejected
                + summary.artifact_rejected
                + summary.interrupted
                > 0
        })
        .flat_map(|summary| class_warnings(summary.emotion, summary.accepted))
        .collect();

    ParadigmSessionSummary {
        session_id: session_id.to_string(),
        total_trials: records.len() as u32,
        per_class,
        valence_mean: mean(records.iter().filter_map(|record| record.self_report_valence)),
        arousal_mean: mean(records.iter().filter_map(|record| record.self_report_arousal)),
        warnings,
    }
}

fn quality_count(records: &[TrialRecord], emotion: ParadigmEmotion, quality: TrialQuality) -> u32 {
    records
        .iter()
        .filter(|record| {
            record.paradigm_emotion == emotion && record.quality == Some(quality)
        })
        .count() as u32
}

fn class_warnings(emotion: ParadigmEmotion, accepted: u32) -> Vec<String> {
    let name = emotion.display_name();
    if accepted < MIN_ACCEPTED_FOR_TRAINING {
        return vec![
            format!("{name} has only {accepted} accepted trials; collect more before training."),
            format!(
                "{name} is below the minimum of {MIN_ACCEPTED_FOR_TRAINING} accepted trials required for training."
            ),
        ];
    }
    if accepted < RECOMMENDED_ACCEPTED {
        return vec![format!(
            "{name} has only {accepted} accepted trials; consider collecting more to reach {RECOMMENDED_ACCEPTED}."
        )];
    }
    Vec::new()
}

fn mean(values: impl Iterator<Item = u8>) -> Option<f64> {
    let mut total = 0_u64;
    let mut count = 0_u64;
    for value in values {
        total += value as u64;
        count += 1;
    }
    (count > 0).then(|| total as f64 / count as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trial_record_serializes_camel_case_field_names() {
        let record = TrialRecord {
            trial_id: TrialRecord::trial_id_for("run-1", 0),
            session_id: "session-1".to_string(),
            subject_id: "subject-1".to_string(),
            session_run_id: "run-1".to_string(),
            study_session: ParadigmSessionKind::PersonalCalibration,
            trial_index: 0,
            status: TrialStatus::Completed,
            phase: "personal_calibration".to_string(),
            paradigm_emotion: ParadigmEmotion::Depression,
            system_emotion: None,
            trigger_class: 1,
            video_id: "dep_a".to_string(),
            video_path: "X:/videos/dep_a.mp4".to_string(),
            trigger_start_ts: None,
            trigger_end_ts: None,
            eeg_start_ts: "2026-08-23T10:00:00+00:00".to_string(),
            eeg_end_ts: Some("2026-08-23T10:00:30+00:00".to_string()),
            eeg_start_sample_index: 0,
            eeg_end_sample_index: Some(30_000),
            sample_rate_hz: 1000,
            channel_count: 32,
            recording_path: "X:/recordings/session-1".to_string(),
            self_report_valence: Some(3),
            self_report_arousal: Some(3),
            self_report_dominance: Some(2),
            self_report_acceptance: Some(TrialQuality::Accepted),
            quality: Some(TrialQuality::Accepted),
            label_source: Some(super::super::paradigm::LabelSource::SelfReportConfirmed),
            artifact_flags: Vec::new(),
            operator_notes: None,
            created_at: "2026-08-23T10:01:00+00:00".to_string(),
        };

        let value = serde_json::to_value(&record).expect("serialize record");
        assert_eq!(value["trialId"], "run-1_t01");
        assert_eq!(value["selfReportValence"], 3);
        assert_eq!(value["selfReportAcceptance"], "accepted");
        assert_eq!(value["paradigmEmotion"], "depression");
        assert_eq!(value["studySession"], "personal_calibration");
        assert_eq!(value["recordingPath"], "X:/recordings/session-1");

        let parsed: TrialRecord = serde_json::from_value(value).expect("deserialize record");
        assert_eq!(parsed, record);
    }

    #[test]
    fn acceptance_matches_paradigm_reference_cases() {
        let cases: &[(ParadigmEmotion, u8, u8, TrialQuality)] = &[
            (ParadigmEmotion::Depression, 3, 3, TrialQuality::Accepted),
            (ParadigmEmotion::Depression, 3, 6, TrialQuality::Uncertain),
            (ParadigmEmotion::Depression, 5, 3, TrialQuality::Uncertain),
            (ParadigmEmotion::Depression, 7, 5, TrialQuality::Rejected),
            (ParadigmEmotion::Anxiety, 2, 8, TrialQuality::Accepted),
            (ParadigmEmotion::Anxiety, 3, 5, TrialQuality::Uncertain),
            (ParadigmEmotion::Anxiety, 5, 2, TrialQuality::Rejected),
            (ParadigmEmotion::Calm, 6, 2, TrialQuality::Accepted),
            (ParadigmEmotion::Calm, 5, 5, TrialQuality::Uncertain),
            (ParadigmEmotion::Calm, 6, 7, TrialQuality::Rejected),
            (ParadigmEmotion::Calm, 4, 2, TrialQuality::Uncertain),
            (ParadigmEmotion::Happy, 7, 6, TrialQuality::Accepted),
            (ParadigmEmotion::Happy, 5, 6, TrialQuality::Uncertain),
            (ParadigmEmotion::Happy, 8, 9, TrialQuality::Rejected),
            (ParadigmEmotion::Happy, 3, 7, TrialQuality::Rejected),
        ];

        for (emotion, valence, arousal, expected) in cases {
            assert_eq!(
                compute_acceptance(*emotion, *valence, *arousal),
                *expected,
                "{emotion:?}(v={valence}, a={arousal})"
            );
        }
    }

    fn summary_record(emotion: ParadigmEmotion, quality: Option<TrialQuality>) -> TrialRecord {
        TrialRecord {
            trial_id: format!("run-1_t{:02}", emotion.trigger_code()),
            session_id: "session-1".to_string(),
            subject_id: "subject-1".to_string(),
            session_run_id: "run-1".to_string(),
            study_session: super::super::paradigm::ParadigmSessionKind::PersonalCalibration,
            trial_index: emotion.trigger_code() as u32,
            status: if quality.is_none() {
                TrialStatus::Interrupted
            } else {
                TrialStatus::Completed
            },
            phase: "personal_calibration".to_string(),
            paradigm_emotion: emotion,
            system_emotion: None,
            trigger_class: emotion.trigger_code(),
            video_id: format!("{}-a", emotion.wire_str()),
            video_path: format!("X:/videos/{}-a.mp4", emotion.wire_str()),
            trigger_start_ts: None,
            trigger_end_ts: None,
            eeg_start_ts: "2026-08-23T10:00:00+00:00".to_string(),
            eeg_end_ts: Some("2026-08-23T10:00:30+00:00".to_string()),
            eeg_start_sample_index: 0,
            eeg_end_sample_index: Some(30_000),
            sample_rate_hz: 1000,
            channel_count: 32,
            recording_path: "X:/recordings/session-1".to_string(),
            self_report_valence: None,
            self_report_arousal: None,
            self_report_dominance: None,
            self_report_acceptance: None,
            quality,
            label_source: None,
            artifact_flags: Vec::new(),
            operator_notes: None,
            created_at: "2026-08-23T10:01:00+00:00".to_string(),
        }
    }

    #[test]
    fn summary_counts_qualities_and_interrupts_per_class() {
        let records = vec![
            summary_record(ParadigmEmotion::Depression, Some(TrialQuality::Accepted)),
            summary_record(ParadigmEmotion::Depression, Some(TrialQuality::Accepted)),
            summary_record(ParadigmEmotion::Depression, Some(TrialQuality::Accepted)),
            summary_record(ParadigmEmotion::Depression, Some(TrialQuality::Rejected)),
            summary_record(ParadigmEmotion::Depression, None),
            summary_record(ParadigmEmotion::Calm, Some(TrialQuality::Uncertain)),
        ];

        let summary = summarize_trials("session-1", &records);

        assert_eq!(summary.session_id, "session-1");
        assert_eq!(summary.total_trials, 6);
        let depression = summary
            .per_class
            .iter()
            .find(|class| class.emotion == ParadigmEmotion::Depression)
            .expect("depression summary");
        assert_eq!(depression.accepted, 3);
        assert_eq!(depression.rejected, 1);
        assert_eq!(depression.interrupted, 1);
        // Depression passed the minimum of 3, so only the collect-more hint applies.
        assert_eq!(
            summary
                .warnings
                .iter()
                .filter(|warning| warning.starts_with("Depression"))
                .cloned()
                .collect::<Vec<_>>(),
            vec![
                "Depression has only 3 accepted trials; consider collecting more to reach 5."
                    .to_string()
            ]
        );
    }

    fn depression_warnings(records: &[TrialRecord]) -> Vec<String> {
        summarize_trials("session-1", records)
            .warnings
            .into_iter()
            .filter(|warning| warning.starts_with("Depression"))
            .collect()
    }

    #[test]
    fn summary_warns_twice_below_minimum_and_once_below_recommendation() {
        let low = depression_warnings(&[
            summary_record(ParadigmEmotion::Depression, Some(TrialQuality::Accepted)),
            summary_record(ParadigmEmotion::Depression, Some(TrialQuality::Accepted)),
        ]);
        assert_eq!(
            low,
            vec![
                "Depression has only 2 accepted trials; collect more before training.".to_string(),
                "Depression is below the minimum of 3 accepted trials required for training."
                    .to_string(),
            ]
        );

        let mid = depression_warnings(&[
            summary_record(ParadigmEmotion::Depression, Some(TrialQuality::Accepted)),
            summary_record(ParadigmEmotion::Depression, Some(TrialQuality::Accepted)),
            summary_record(ParadigmEmotion::Depression, Some(TrialQuality::Accepted)),
            summary_record(ParadigmEmotion::Depression, Some(TrialQuality::Accepted)),
        ]);
        assert_eq!(
            mid,
            vec![
                "Depression has only 4 accepted trials; consider collecting more to reach 5."
                    .to_string()
            ]
        );

        let enough = depression_warnings(&[
            summary_record(ParadigmEmotion::Depression, Some(TrialQuality::Accepted)),
            summary_record(ParadigmEmotion::Depression, Some(TrialQuality::Accepted)),
            summary_record(ParadigmEmotion::Depression, Some(TrialQuality::Accepted)),
            summary_record(ParadigmEmotion::Depression, Some(TrialQuality::Accepted)),
            summary_record(ParadigmEmotion::Depression, Some(TrialQuality::Accepted)),
        ]);
        assert!(enough.is_empty());
    }

    #[test]
    fn summary_means_cover_reported_scores_only() {
        let mut first = summary_record(ParadigmEmotion::Happy, Some(TrialQuality::Accepted));
        first.self_report_valence = Some(7);
        first.self_report_arousal = Some(6);
        let mut second = summary_record(ParadigmEmotion::Happy, Some(TrialQuality::Accepted));
        second.self_report_valence = Some(5);
        second.self_report_arousal = Some(8);
        let interrupted = summary_record(ParadigmEmotion::Happy, None);

        let summary = summarize_trials(
            "session-1",
            &[first, second, interrupted],
        );

        assert_eq!(summary.valence_mean, Some(6.0));
        assert_eq!(summary.arousal_mean, Some(7.0));
    }

    #[test]
    fn summary_means_are_none_without_self_reports() {
        let summary = summarize_trials("session-1", &[]);

        assert_eq!(summary.total_trials, 0);
        assert_eq!(summary.valence_mean, None);
        assert_eq!(summary.arousal_mean, None);
    }
}
