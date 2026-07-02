use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct NeuroMusicHealthResponse {
    pub status: String,
    pub model_loaded: bool,
    pub model_version: String,
    pub demon_control_available: bool,
    pub active_session: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EegEmotionPredictRequest {
    pub channel_ids: Vec<String>,
    pub sample_rate_hz: u32,
    pub started_at_ms: Option<i64>,
    pub samples: Vec<Vec<f32>>,
    pub trigger_class: Option<u8>,
    pub source: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct EegEmotionResponse {
    pub emotion: String,
    pub probabilities: HashMap<String, f64>,
    pub valence: f64,
    pub arousal: f64,
    pub confidence: f64,
    pub source: String,
    pub updated_at: f64,
    pub model_version: String,
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StartNeuroMusicSessionRequest {
    pub user_id: String,
    pub username: String,
    pub mode: String,
    pub prompt: String,
}

#[derive(Debug, Serialize)]
pub struct NeuroEmotionControlRequest {
    pub emotion: String,
    pub probabilities: HashMap<String, f64>,
    pub valence: f64,
    pub arousal: f64,
    pub playback_pos: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct NeuroMusicSessionStatus {
    pub active: bool,
    pub session_id: Option<String>,
    pub mode: String,
    pub prompt: String,
    pub started_at: Option<f64>,
    pub last_emotion: Option<String>,
    pub last_control: Option<serde_json::Value>,
    pub demon_session_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct NeuroMusicClient {
    base_url: String,
    client: reqwest::Client,
}

impl NeuroMusicClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            client: reqwest::Client::new(),
        }
    }

    pub async fn health(&self) -> Result<NeuroMusicHealthResponse, String> {
        self.get_json("/health").await
    }

    pub async fn predict_eeg_emotion(
        &self,
        request: &EegEmotionPredictRequest,
    ) -> Result<EegEmotionResponse, String> {
        self.post_json("/eeg/emotion/predict", request).await
    }

    pub async fn latest_eeg_emotion(&self) -> Result<EegEmotionResponse, String> {
        self.get_json("/eeg/emotion/latest").await
    }

    pub async fn start_session(
        &self,
        request: &StartNeuroMusicSessionRequest,
    ) -> Result<NeuroMusicSessionStatus, String> {
        self.post_json("/session/start", request).await
    }

    pub async fn stop_session(&self) -> Result<NeuroMusicSessionStatus, String> {
        self.post_json("/session/stop", &serde_json::json!({})).await
    }

    pub async fn session_status(&self) -> Result<NeuroMusicSessionStatus, String> {
        self.get_json("/session/status").await
    }

    pub async fn control_emotion(
        &self,
        request: &NeuroEmotionControlRequest,
    ) -> Result<NeuroMusicSessionStatus, String> {
        self.post_json("/control/emotion", request).await
    }

    async fn get_json<T>(&self, path: &str) -> Result<T, String>
    where
        T: for<'de> Deserialize<'de>,
    {
        let response = self
            .client
            .get(format!("{}{}", self.base_url, path))
            .send()
            .await
            .map_err(|_| "Failed to reach realtime neuro music service.".to_string())?;

        if !response.status().is_success() {
            return Err(format!(
                "Realtime neuro music service returned HTTP {}.",
                response.status()
            ));
        }

        response
            .json::<T>()
            .await
            .map_err(|_| "Realtime neuro music service returned an invalid response.".to_string())
    }

    async fn post_json<T, B>(&self, path: &str, body: &B) -> Result<T, String>
    where
        T: for<'de> Deserialize<'de>,
        B: Serialize + ?Sized,
    {
        let response = self
            .client
            .post(format!("{}{}", self.base_url, path))
            .json(body)
            .send()
            .await
            .map_err(|_| "Failed to reach realtime neuro music service.".to_string())?;

        if !response.status().is_success() {
            return Err(format!(
                "Realtime neuro music service returned HTTP {}.",
                response.status()
            ));
        }

        response
            .json::<T>()
            .await
            .map_err(|_| "Realtime neuro music service returned an invalid response.".to_string())
    }
}
