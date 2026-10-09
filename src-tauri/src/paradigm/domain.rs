use serde::{Deserialize, Serialize};
/// Lifecycle stage of a current experiment paradigm.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParadigmSessionKind {
    PersonalCalibration,
    HeldOutGeneration,
}

/// Emotion class induced by a trial video. Trigger codes are written to the
/// BioSemi Status channel through the external trigger interface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParadigmEmotion {
    Depression,
    Anxiety,
    Calm,
    Fear,
}

pub const PARADIGM_EMOTIONS: [ParadigmEmotion; 4] = [
    ParadigmEmotion::Depression,
    ParadigmEmotion::Anxiety,
    ParadigmEmotion::Calm,
    ParadigmEmotion::Fear,
];

/// Block schedule per session kind. Each block plays five videos.
pub fn blocks_for_session_kind(kind: ParadigmSessionKind) -> &'static [ParadigmEmotion] {
    match kind {
        ParadigmSessionKind::PersonalCalibration => &[ParadigmEmotion::Calm],
        ParadigmSessionKind::HeldOutGeneration => &[
            ParadigmEmotion::Anxiety,
            ParadigmEmotion::Depression,
            ParadigmEmotion::Fear,
        ],
    }
}

/// Whether the class participates in the current experiment schedule.
pub fn is_scheduled_emotion(emotion: ParadigmEmotion) -> bool {
    [
        ParadigmSessionKind::PersonalCalibration,
        ParadigmSessionKind::HeldOutGeneration,
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
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            ParadigmEmotion::Depression => "Depression",
            ParadigmEmotion::Anxiety => "Anxiety",
            ParadigmEmotion::Calm => "Calm",
            ParadigmEmotion::Fear => "Fear",
        }
    }

    // Used by tests today; wire/persistence layers adopt these next.
    #[allow(dead_code)]
    pub fn wire_str(self) -> &'static str {
        match self {
            ParadigmEmotion::Depression => "depression",
            ParadigmEmotion::Anxiety => "anxiety",
            ParadigmEmotion::Calm => "calm",
            ParadigmEmotion::Fear => "fear",
        }
    }

    #[allow(dead_code)]
    pub fn from_db_str(value: &str) -> Result<Self, String> {
        match value {
            "depression" => Ok(Self::Depression),
            "anxiety" => Ok(Self::Anxiety),
            "calm" => Ok(Self::Calm),
            "fear" => Ok(Self::Fear),
            _ => Err("Unknown paradigm emotion.".to_string()),
        }
    }
}

/// Quality label attached to a trial, either suggested from the self-report
/// or decided by the operator. Consumed by `quality::compute_acceptance`,
/// which is not yet declared as a module.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrialQuality {
    Accepted,
    Uncertain,
    Rejected,
    ArtifactRejected,
}

/// Self-assessment scores collected by the frontend after a trial ends.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfReportInput {
    pub valence: u8,
    pub arousal: u8,
    pub dominance: Option<u8>,
}

#[allow(dead_code)]
impl SelfReportInput {
    pub fn validate(&self) -> Result<(), String> {
        const MESSAGE: &str = "Self-report scores must be between 1 and 9.";
        if !(1..=9).contains(&self.valence) || !(1..=9).contains(&self.arousal) {
            return Err(MESSAGE.to_string());
        }
        if self
            .dominance
            .is_some_and(|value| !(1..=9).contains(&value))
        {
            return Err(MESSAGE.to_string());
        }
        Ok(())
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
    pub valid: bool,
    pub problems: Vec<String>,
    /// Non-blocking content-readiness notices used for contractual library
    /// checks. They do not prevent a short pipeline shakedown from running.
    pub readiness_warnings: Vec<String>,
}

impl ParadigmVideoLibrary {
    pub fn entries_for(&self, emotion: ParadigmEmotion) -> &[ParadigmVideoEntry] {
        match emotion {
            ParadigmEmotion::Depression => &self.depression,
            ParadigmEmotion::Anxiety => &self.anxiety,
            ParadigmEmotion::Calm => &self.calm,
            ParadigmEmotion::Fear => &self.fear,
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
