use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const EVENT_CODES: &[(&str, u8)] = &[
    ("depression_video_start", 1),
    ("anxiety_video_start", 2),
    ("calm_video_start", 3),
    ("fear_video_start", 5),
    ("induction_video_end", 10),
    ("baseline_rest_start", 20),
    ("hint_start", 21),
    ("post_rest_start", 22),
    ("music_regulation_start", 31),
    ("music_regulation_end", 32),
    ("video_regulation_start", 41),
    ("video_regulation_end", 42),
    ("natural_recovery_start", 51),
    ("natural_recovery_end", 52),
    ("run_start", 60),
    ("run_end", 61),
    ("pre_scale_start", 70),
    ("pre_scale_submit", 71),
    ("post_scale_start", 72),
    ("post_scale_submit", 73),
    ("sam_start", 74),
    ("sam_submit", 75),
    ("media_pause", 80),
    ("media_resume", 81),
    ("media_change", 82),
    ("playback_error", 90),
    ("run_abort", 91),
    ("trial_skip", 92),
    ("trial_start", 93),
    ("trial_end", 94),
];
pub fn code(event: &str) -> Result<u8, String> {
    EVENT_CODES
        .iter()
        .find(|(name, _)| *name == event)
        .map(|(_, code)| *code)
        .ok_or_else(|| "Unknown or reserved experiment event.".into())
}
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartInput {
    pub user_id: String,
    pub subject_id: String,
    pub kind: String,
    pub emotion: Option<String>,
    pub condition: Option<String>,
    pub method: Option<String>,
    pub duration_minutes: Option<f64>,
    pub mode: String,
    pub external_recording_confirmed: bool,
    pub expected_recording_name: Option<String>,
    pub materials: Option<Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub run_id: String,
    #[serde(flatten)]
    pub input: StartInput,
    pub status: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub protocol_version: String,
    pub event_mapping_version: String,
    pub external_recording_confirmed_at: Option<String>,
    pub bdf_files: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInput {
    pub event_id: String,
    pub run_id: String,
    pub event: String,
    pub phase_instance_id: String,
    pub trial_id: Option<String>,
    pub media_id: Option<String>,
    pub software_time_ms: Option<f64>,
    pub source: Option<String>,
    pub details: Option<Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    #[serde(flatten)]
    pub input: EventInput,
    pub sequence: u64,
    pub code: u8,
    pub received_at: String,
    pub backend_elapsed_ms: f64,
    pub write_started_at: Option<String>,
    pub write_finished_at: Option<String>,
    pub queue_wait_ms: Option<f64>,
    pub result: String,
    pub error: Option<String>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub connected: bool,
    pub port_name: Option<String>,
    pub active_run_id: Option<String>,
    pub last_error: Option<String>,
}
