use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    pub prompt: String,
    pub negative_prompt: String,
    pub duration: u32,
    pub job_id: String,
    pub output_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateResponse {
    pub job_id: String,
    pub status: String,
    pub progress: u8,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub status: String,
    pub model_loaded: bool,
    pub model_version: String,
    pub gpu_available: bool,
    pub device: String,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct PythonClient {
    base_url: String,
    client: reqwest::Client,
}

impl PythonClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            client: reqwest::Client::new(),
        }
    }

    pub async fn generate(&self, request: &GenerateRequest) -> Result<GenerateResponse, String> {
        let url = format!("{}/generate", self.base_url);
        let response = self
            .client
            .post(url)
            .json(request)
            .send()
            .await
            .map_err(|_| "Failed to reach music generation service.".to_string())?;

        if !response.status().is_success() {
            return Err(format!(
                "Music generation service returned HTTP {}.",
                response.status()
            ));
        }

        response
            .json::<GenerateResponse>()
            .await
            .map_err(|_| "Music generation service returned an invalid response.".to_string())
    }

    pub async fn health(&self) -> Result<HealthResponse, String> {
        let url = format!("{}/health", self.base_url);
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| "Failed to reach music generation service.".to_string())?;

        if !response.status().is_success() {
            return Err(format!(
                "Music generation service returned HTTP {}.",
                response.status()
            ));
        }

        response
            .json::<HealthResponse>()
            .await
            .map_err(|_| "Music generation service returned an invalid response.".to_string())
    }
}
