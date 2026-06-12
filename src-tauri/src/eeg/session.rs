use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartEegRecordingInput {
    pub user_id: String,
    pub username: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EegRecordingSession {
    pub id: String,
    pub user_id: String,
    pub username: String,
    pub session_dir: String,
    pub eeg_file: String,
    pub trigger_file: String,
    pub metadata_file: String,
    pub sample_rate_hz: u32,
    pub channel_count: usize,
    pub sample_count: u64,
    pub duration_seconds: Option<f64>,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EegStatus {
    pub is_streaming: bool,
    pub is_recording: bool,
    pub eeg_connected: bool,
    pub trigger_connected: bool,
    pub last_error: Option<String>,
    pub sample_rate_hz: u32,
    pub block_interval_ms: u64,
    pub channel_ids: Vec<String>,
    pub active_recording: Option<EegRecordingSession>,
}
