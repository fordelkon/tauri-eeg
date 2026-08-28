use serde::{Deserialize, Serialize};

// Record and summary shapes live in paradigm_rules next to the aggregation
// logic; re-exported here so `paradigm::*` is the single public surface.
pub use super::paradigm_rules::{ParadigmSessionSummary, TrialRecord};

/// Lifecycle stage of a paradigm recording session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParadigmSessionKind {
    PersonalCalibration,
    HeldOutGeneration,
    RegulationFeedback,
}

impl ParadigmSessionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ParadigmSessionKind::PersonalCalibration => "personal_calibration",
            ParadigmSessionKind::HeldOutGeneration => "held_out_generation",
            ParadigmSessionKind::RegulationFeedback => "regulation_feedback",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self, String> {
        match value {
            "personal_calibration" => Ok(Self::PersonalCalibration),
            "held_out_generation" => Ok(Self::HeldOutGeneration),
            "regulation_feedback" => Ok(Self::RegulationFeedback),
            _ => Err("Unknown paradigm session kind.".to_string()),
        }
    }
}

/// Emotion class induced by a trial video; trigger codes follow the hardware
/// trigger layout (1-5 for the classes, 255 marks the end of a trial). Fear
/// took over Happy's slot in the acquisition schedules (R8, 大纲 6.1); Happy
/// stays on the wire contract so legacy 'happy' records keep parsing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParadigmEmotion {
    Depression,
    Anxiety,
    Calm,
    Fear,
    /// Retired from every acquisition schedule (R8): no block schedules it
    /// and its video pool is neither required nor validated on library load.
    /// Kept only so pre-R8 'happy' trial records and summaries still parse.
    Happy,
}

pub const PARADIGM_EMOTIONS: [ParadigmEmotion; 5] = [
    ParadigmEmotion::Depression,
    ParadigmEmotion::Anxiety,
    ParadigmEmotion::Calm,
    ParadigmEmotion::Fear,
    ParadigmEmotion::Happy,
];

/// Block schedule per session kind: personal calibration collects only the
/// calm baseline block, while the held-out generation and regulation feedback
/// runs induce the three emotion blocks (anxiety, depression, fear) in order
/// (R8, 大纲 6.1 焦虑/抑郁/恐惧; Happy has retired from every schedule and only
/// survives on the wire contract for legacy records). Each block shuffles
/// its class pool and plays its five videos back to back.
pub fn blocks_for_session_kind(kind: ParadigmSessionKind) -> &'static [ParadigmEmotion] {
    match kind {
        ParadigmSessionKind::PersonalCalibration => &[ParadigmEmotion::Calm],
        ParadigmSessionKind::HeldOutGeneration => &[
            ParadigmEmotion::Anxiety,
            ParadigmEmotion::Depression,
            ParadigmEmotion::Fear,
        ],
        // Regulation feedback is not an acquisition run; if it ever reaches
        // the queue builder, treat it like the induction schedule.
        ParadigmSessionKind::RegulationFeedback => &[
            ParadigmEmotion::Anxiety,
            ParadigmEmotion::Depression,
            ParadigmEmotion::Fear,
        ],
    }
}

/// Whether the class participates in some acquisition schedule. Only
/// scheduled classes require a video directory and a full pool on library
/// load; retired classes (Happy) are loaded opportunistically when their
/// directory happens to exist, but never validated.
pub fn is_scheduled_emotion(emotion: ParadigmEmotion) -> bool {
    [
        ParadigmSessionKind::PersonalCalibration,
        ParadigmSessionKind::HeldOutGeneration,
        ParadigmSessionKind::RegulationFeedback,
    ]
    .iter()
    .any(|kind| blocks_for_session_kind(*kind).contains(&emotion))
}

impl ParadigmEmotion {
    pub fn trigger_code(self) -> u8 {
        match self {
            ParadigmEmotion::Depression => 1,
            ParadigmEmotion::Anxiety => 2,
            ParadigmEmotion::Calm => 3,
            ParadigmEmotion::Fear => 5,
            ParadigmEmotion::Happy => 4,
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            ParadigmEmotion::Depression => "Depression",
            ParadigmEmotion::Anxiety => "Anxiety",
            ParadigmEmotion::Calm => "Calm",
            ParadigmEmotion::Fear => "Fear",
            ParadigmEmotion::Happy => "Happy",
        }
    }

    pub fn wire_str(self) -> &'static str {
        match self {
            ParadigmEmotion::Depression => "depression",
            ParadigmEmotion::Anxiety => "anxiety",
            ParadigmEmotion::Calm => "calm",
            ParadigmEmotion::Fear => "fear",
            ParadigmEmotion::Happy => "happy",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self, String> {
        match value {
            "depression" => Ok(Self::Depression),
            "anxiety" => Ok(Self::Anxiety),
            "calm" => Ok(Self::Calm),
            "fear" => Ok(Self::Fear),
            "happy" => Ok(Self::Happy),
            _ => Err("Unknown paradigm emotion.".to_string()),
        }
    }
}

/// Phase mark inside a trial, set by the operator while the video plays.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrialMarkKind {
    PreVideoHint,
    Video,
    PostVideoRest,
}

/// Quality label attached to a trial, either suggested from the self-report
/// or decided by the operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrialQuality {
    Accepted,
    Uncertain,
    Rejected,
    ArtifactRejected,
}

impl TrialQuality {
    pub fn as_str(self) -> &'static str {
        match self {
            TrialQuality::Accepted => "accepted",
            TrialQuality::Uncertain => "uncertain",
            TrialQuality::Rejected => "rejected",
            TrialQuality::ArtifactRejected => "artifact_rejected",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self, String> {
        match value {
            "accepted" => Ok(Self::Accepted),
            "uncertain" => Ok(Self::Uncertain),
            "rejected" => Ok(Self::Rejected),
            "artifact_rejected" => Ok(Self::ArtifactRejected),
            _ => Err("Unknown trial quality.".to_string()),
        }
    }
}

/// How the effective label of a trial was determined.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LabelSource {
    InductionTarget,
    SelfReportConfirmed,
    ModelPrediction,
}

impl LabelSource {
    pub fn as_str(self) -> &'static str {
        match self {
            LabelSource::InductionTarget => "induction_target",
            LabelSource::SelfReportConfirmed => "self_report_confirmed",
            LabelSource::ModelPrediction => "model_prediction",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self, String> {
        match value {
            "induction_target" => Ok(Self::InductionTarget),
            "self_report_confirmed" => Ok(Self::SelfReportConfirmed),
            "model_prediction" => Ok(Self::ModelPrediction),
            _ => Err("Unknown label source.".to_string()),
        }
    }
}

/// Completion state of a trial; interrupted trials never carry a quality.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrialStatus {
    Completed,
    Interrupted,
}

impl TrialStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TrialStatus::Completed => "completed",
            TrialStatus::Interrupted => "interrupted",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self, String> {
        match value {
            "completed" => Ok(Self::Completed),
            "interrupted" => Ok(Self::Interrupted),
            _ => Err("Unknown trial status.".to_string()),
        }
    }
}

/// Paradigm descriptor attached to a recording at start time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParadigmInfo {
    pub study_session: ParadigmSessionKind,
    pub subject_id: String,
    pub session_run_id: String,
}

/// Self-assessment scores collected by the frontend after a trial ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfReportInput {
    pub valence: u8,
    pub arousal: u8,
    pub dominance: Option<u8>,
}

impl SelfReportInput {
    pub fn validate(&self) -> Result<(), String> {
        const MESSAGE: &str = "Self-report scores must be between 1 and 9.";
        if !(1..=9).contains(&self.valence) || !(1..=9).contains(&self.arousal) {
            return Err(MESSAGE.to_string());
        }
        if self.dominance.is_some_and(|value| !(1..=9).contains(&value)) {
            return Err(MESSAGE.to_string());
        }
        Ok(())
    }
}

/// IPC-side quality label for finalize: the wire format also accepts the
/// "interrupted" status value so it can be rejected with a clear message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FinalizeQualityInput {
    Accepted,
    Uncertain,
    Rejected,
    ArtifactRejected,
    Interrupted,
}

impl FinalizeQualityInput {
    pub fn into_quality(self) -> Result<TrialQuality, String> {
        match self {
            Self::Accepted => Ok(TrialQuality::Accepted),
            Self::Uncertain => Ok(TrialQuality::Uncertain),
            Self::Rejected => Ok(TrialQuality::Rejected),
            Self::ArtifactRejected => Ok(TrialQuality::ArtifactRejected),
            Self::Interrupted => Err("Use End Session to interrupt a trial.".to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParadigmVideoEntry {
    pub video_id: String,
    pub file_name: String,
    pub absolute_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParadigmVideoLibrary {
    pub root_path: String,
    pub depression: Vec<ParadigmVideoEntry>,
    pub anxiety: Vec<ParadigmVideoEntry>,
    pub calm: Vec<ParadigmVideoEntry>,
    pub fear: Vec<ParadigmVideoEntry>,
    /// Legacy pool (Happy retired in R8): populated only when an old library
    /// still carries a Happy directory; never scheduled, never validated.
    pub happy: Vec<ParadigmVideoEntry>,
    pub valid: bool,
    pub problems: Vec<String>,
}

impl ParadigmVideoLibrary {
    pub fn entries_for(&self, emotion: ParadigmEmotion) -> &[ParadigmVideoEntry] {
        match emotion {
            ParadigmEmotion::Depression => &self.depression,
            ParadigmEmotion::Anxiety => &self.anxiety,
            ParadigmEmotion::Calm => &self.calm,
            ParadigmEmotion::Fear => &self.fear,
            ParadigmEmotion::Happy => &self.happy,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParadigmTrialPlanItem {
    pub trial_index: u32,
    pub emotion: ParadigmEmotion,
    pub trigger_class: u8,
    pub video_id: String,
    pub video_path: String,
}

/// Non-zero trigger code observed on the trigger channel at a sample index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerObservation {
    pub code: i32,
    pub sample_index: u64,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialMarkRecord {
    pub mark: TrialMarkKind,
    pub sample_index: u64,
    pub timestamp: String,
}

/// Live view of the trial in progress, returned by the trial commands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialSnapshot {
    pub trial_index: u32,
    pub emotion: ParadigmEmotion,
    pub trigger_class: u8,
    pub video_id: String,
    pub video_path: String,
    pub eeg_start_sample_index: u64,
    pub eeg_start_ts: String,
    pub eeg_end_sample_index: Option<u64>,
    pub eeg_end_ts: Option<String>,
    pub marks: Vec<TrialMarkRecord>,
    pub hardware_triggers: Vec<TriggerObservation>,
    pub trigger_start_ts: Option<String>,
    pub trigger_end_ts: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParadigmVideoLibraryInput {
    pub root_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParadigmQueueInput {
    pub root_path: String,
    pub session_run_id: String,
    pub session_kind: ParadigmSessionKind,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginEegTrialInput {
    pub trial_index: u32,
    pub emotion: ParadigmEmotion,
    pub video_id: String,
    pub video_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkEegTrialInput {
    pub mark: TrialMarkKind,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeEegTrialInput {
    #[serde(default)]
    pub self_report: Option<SelfReportInput>,
    pub quality: Option<FinalizeQualityInput>,
    #[serde(default)]
    pub artifact_flags: Vec<String>,
    #[serde(default)]
    pub operator_notes: Option<String>,
    #[serde(default)]
    pub label_source: Option<LabelSource>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParadigmSummaryInput {
    pub session_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enums_serialize_to_contract_wire_values() {
        assert_eq!(
            serde_json::to_string(&ParadigmSessionKind::HeldOutGeneration).expect("serialize"),
            r#""held_out_generation""#
        );
        assert_eq!(
            serde_json::to_string(&ParadigmEmotion::Depression).expect("serialize"),
            r#""depression""#
        );
        assert_eq!(
            serde_json::to_string(&ParadigmEmotion::Fear).expect("serialize"),
            r#""fear""#
        );
        assert_eq!(
            serde_json::from_str::<ParadigmEmotion>(r#""fear""#).expect("deserialize"),
            ParadigmEmotion::Fear
        );
        // Legacy pre-R8 'happy' records still parse on the wire contract.
        assert_eq!(
            serde_json::from_str::<ParadigmEmotion>(r#""happy""#).expect("deserialize"),
            ParadigmEmotion::Happy
        );
        assert_eq!(
            serde_json::to_string(&TrialMarkKind::PostVideoRest).expect("serialize"),
            r#""post_video_rest""#
        );
        assert_eq!(
            serde_json::to_string(&TrialQuality::ArtifactRejected).expect("serialize"),
            r#""artifact_rejected""#
        );
        assert_eq!(
            serde_json::to_string(&LabelSource::SelfReportConfirmed).expect("serialize"),
            r#""self_report_confirmed""#
        );
        assert_eq!(
            serde_json::to_string(&TrialStatus::Interrupted).expect("serialize"),
            r#""interrupted""#
        );
    }

    #[test]
    fn emotion_wire_strings_round_trip_and_reject_unknown_values() {
        for emotion in PARADIGM_EMOTIONS {
            assert_eq!(
                ParadigmEmotion::from_db_str(emotion.wire_str()).expect("round trip"),
                emotion,
                "{emotion:?} wire round trip"
            );
        }
        assert_eq!(
            ParadigmEmotion::from_db_str("anger").unwrap_err(),
            "Unknown paradigm emotion."
        );
    }

    #[test]
    fn emotion_trigger_codes_follow_hardware_layout() {
        assert_eq!(ParadigmEmotion::Depression.trigger_code(), 1);
        assert_eq!(ParadigmEmotion::Anxiety.trigger_code(), 2);
        assert_eq!(ParadigmEmotion::Calm.trigger_code(), 3);
        assert_eq!(ParadigmEmotion::Fear.trigger_code(), 5);
        // Happy keeps its historical code 4 even though it is retired; every
        // class must keep a unique code distinct from the 255 trial-end mark.
        assert_eq!(ParadigmEmotion::Happy.trigger_code(), 4);
        let codes: Vec<u8> = PARADIGM_EMOTIONS.map(|emotion| emotion.trigger_code()).to_vec();
        let mut unique = codes.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(codes.len(), unique.len(), "trigger codes must not collide");
        assert!(
            codes.iter().all(|code| *code != 255),
            "255 is reserved for the trial-end mark"
        );
    }

    #[test]
    fn block_schedules_induce_the_outline_6_1_classes() {
        assert_eq!(
            blocks_for_session_kind(ParadigmSessionKind::PersonalCalibration),
            &[ParadigmEmotion::Calm]
        );
        let induction = [
            ParadigmEmotion::Anxiety,
            ParadigmEmotion::Depression,
            ParadigmEmotion::Fear,
        ];
        assert_eq!(
            blocks_for_session_kind(ParadigmSessionKind::HeldOutGeneration),
            &induction
        );
        assert_eq!(
            blocks_for_session_kind(ParadigmSessionKind::RegulationFeedback),
            &induction
        );
        // Happy retired in R8: never scheduled, still a valid wire value.
        assert!(!is_scheduled_emotion(ParadigmEmotion::Happy));
        for emotion in [
            ParadigmEmotion::Calm,
            ParadigmEmotion::Anxiety,
            ParadigmEmotion::Depression,
            ParadigmEmotion::Fear,
        ] {
            assert!(is_scheduled_emotion(emotion), "{emotion:?} must be scheduled");
        }
    }

    #[test]
    fn self_report_scores_must_be_between_1_and_9() {
        assert!(SelfReportInput {
            valence: 1,
            arousal: 9,
            dominance: Some(5)
        }
        .validate()
        .is_ok());
        assert_eq!(
            SelfReportInput {
                valence: 0,
                arousal: 5,
                dominance: None
            }
            .validate()
            .unwrap_err(),
            "Self-report scores must be between 1 and 9."
        );
        assert_eq!(
            SelfReportInput {
                valence: 5,
                arousal: 10,
                dominance: None
            }
            .validate()
            .unwrap_err(),
            "Self-report scores must be between 1 and 9."
        );
        assert_eq!(
            SelfReportInput {
                valence: 5,
                arousal: 5,
                dominance: Some(0)
            }
            .validate()
            .unwrap_err(),
            "Self-report scores must be between 1 and 9."
        );
    }

    #[test]
    fn finalize_quality_rejects_interrupted_label() {
        assert_eq!(
            FinalizeQualityInput::Interrupted
                .into_quality()
                .unwrap_err(),
            "Use End Session to interrupt a trial."
        );
        assert_eq!(
            FinalizeQualityInput::ArtifactRejected
                .into_quality()
                .expect("quality"),
            TrialQuality::ArtifactRejected
        );
    }
}
