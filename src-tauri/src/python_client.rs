use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct GenerateRequest {
    pub prompt: String,
    pub negative_prompt: String,
    pub duration: u32,
    pub job_id: String,
    pub output_dir: String,
}

#[derive(Debug, Deserialize)]
pub struct GenerateResponse {
    pub job_id: String,
    pub status: String,
    pub progress: u8,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_generate_request_for_fastapi_contract() {
        let request = GenerateRequest {
            prompt: "calm piano".to_string(),
            negative_prompt: "vocals".to_string(),
            duration: 30,
            job_id: "job-1".to_string(),
            output_dir: "D:/music".to_string(),
        };

        let value = serde_json::to_value(request).expect("serialize request");

        assert_eq!(
            value,
            json!({
                "prompt": "calm piano",
                "negative_prompt": "vocals",
                "duration": 30,
                "job_id": "job-1",
                "output_dir": "D:/music"
            })
        );
    }

    #[test]
    fn deserializes_generate_response_from_fastapi_contract() {
        let response: GenerateResponse = serde_json::from_value(json!({
            "job_id": "job-1",
            "status": "completed",
            "progress": 100,
            "output_path": "D:/music/gen_job.wav",
            "error": null
        }))
        .expect("deserialize response");

        assert_eq!(response.job_id, "job-1");
        assert_eq!(
            response.output_path.as_deref(),
            Some("D:/music/gen_job.wav")
        );
    }
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
