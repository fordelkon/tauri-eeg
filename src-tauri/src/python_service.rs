use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::Deserialize;
use tokio::time::sleep;

use crate::python_client::shared_client;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const REQUIRED_AGENT_PLANNER_VERSION: &str = "lm-video-music-stream-v1";
const REQUIRED_AGENT_CAPABILITIES: &[&str] = &[
    "lm_video_selection",
    "lm_music_generation_prompt",
    "lm_planner_streaming",
];
const HEALTH_CACHE_TTL: Duration = Duration::from_secs(5);
// Cold model loads can exceed 30s, so readiness has a generous cap.
const READINESS_TIMEOUT: Duration = Duration::from_secs(120);
const INITIAL_POLL_INTERVAL: Duration = Duration::from_millis(200);
const MAX_POLL_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentHealthResponse {
    status: String,
    planner_version: Option<String>,
    #[serde(default)]
    capabilities: Vec<String>,
}

#[derive(Clone)]
pub struct PythonServiceManager {
    process: Arc<Mutex<Option<Child>>>,
    // Avoids a serial /health roundtrip in front of every command when the
    // service was just confirmed healthy.
    health_cache: Arc<Mutex<HealthCache>>,
    base_url: String,
}

#[derive(Default)]
struct HealthCache {
    service: Option<Instant>,
    agent: Option<Instant>,
}

impl PythonServiceManager {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            health_cache: Arc::new(Mutex::new(HealthCache::default())),
            base_url: "http://127.0.0.1:8000".to_string(),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn ensure_running(&self) -> Result<(), String> {
        if self.service_health_fresh() {
            return Ok(());
        }

        if self.is_healthy().await {
            self.mark_service_healthy();
            return Ok(());
        }

        self.start_service()?;
        self.wait_for_ready().await
    }

    pub async fn ensure_agent_running(&self) -> Result<(), String> {
        if self.agent_health_fresh() {
            return Ok(());
        }

        // Adopt any healthy service with the required version, ours or foreign.
        if self.is_agent_healthy().await {
            self.mark_agent_healthy();
            return Ok(());
        }

        if self.is_healthy().await {
            // Port 8000 answers /health but not the agent contract. Only
            // restart when we own the process; never kill a foreign service.
            if self.has_live_managed_child() {
                self.stop_managed_process()?;
                self.start_service()?;
                return self.wait_for_agent_ready().await;
            }

            return Err(
                "Another service already uses 127.0.0.1:8000 and does not provide the required LM planner version. Stop it and restart the app."
                    .to_string(),
            );
        }

        self.start_service()?;
        self.wait_for_agent_ready().await
    }

    fn start_service(&self) -> Result<(), String> {
        let mut process_guard = self
            .process
            .lock()
            .map_err(|_| "Python service state is unavailable.".to_string())?;

        // A dead child must be cleared so it gets respawned below.
        if let Some(child) = process_guard.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    eprintln!("music generation service exited with {status}; restarting it");
                    *process_guard = None;
                }
                Ok(None) => return Ok(()),
                Err(error) => {
                    eprintln!(
                        "failed to check music generation service status: {error}; restarting it"
                    );
                    *process_guard = None;
                }
            }
        }

        let service_dir = music_service_dir()?;
        let (stdout, stderr) = service_log_streams();

        let mut command = Command::new("uv");
        command
            .current_dir(service_dir)
            .args(["run", "python", "server.py"])
            .stdout(stdout)
            .stderr(stderr);

        configure_music_service_process(&mut command);

        let child = command
            .spawn()
            .map_err(|_| "Failed to start music generation service. Ensure uv is installed and music-service is set up.".to_string())?;

        *process_guard = Some(child);

        Ok(())
    }

    fn stop_managed_process(&self) -> Result<(), String> {
        let child = {
            let mut process_guard = self
                .process
                .lock()
                .map_err(|_| "Python service state is unavailable.".to_string())?;

            process_guard.take()
        };

        if let Some(mut child) = child {
            terminate_child_tree(&mut child);
        }

        self.invalidate_health_cache();

        Ok(())
    }

    async fn is_healthy(&self) -> bool {
        let url = format!("{}/health", self.base_url);

        shared_client()
            .get(url)
            .timeout(Duration::from_secs(2))
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false)
    }

    fn agent_health_url(&self) -> String {
        format!("{}/agent/health", self.base_url)
    }

    async fn is_agent_healthy(&self) -> bool {
        let response = match shared_client()
            .get(self.agent_health_url())
            .timeout(Duration::from_secs(2))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => response,
            _ => return false,
        };

        response
            .json::<AgentHealthResponse>()
            .await
            .map(|health| is_supported_agent_health(&health))
            .unwrap_or(false)
    }

    async fn wait_for_ready(&self) -> Result<(), String> {
        let deadline = Instant::now() + READINESS_TIMEOUT;
        let mut interval = INITIAL_POLL_INTERVAL;

        loop {
            if self.is_healthy().await {
                self.mark_service_healthy();
                return Ok(());
            }

            if self.managed_child_exited() {
                return Err(format!(
                    "Music generation service exited during startup. Check {} for details.",
                    service_log_path("python-service.err.log").display()
                ));
            }

            if Instant::now() + interval >= deadline {
                return Err("Music generation service did not become ready.".to_string());
            }

            sleep(interval).await;
            interval = (interval * 2).min(MAX_POLL_INTERVAL);
        }
    }

    async fn wait_for_agent_ready(&self) -> Result<(), String> {
        let deadline = Instant::now() + READINESS_TIMEOUT;
        let mut interval = INITIAL_POLL_INTERVAL;

        loop {
            if self.is_agent_healthy().await {
                self.mark_agent_healthy();
                return Ok(());
            }

            if self.managed_child_exited() {
                return Err(format!(
                    "Agent planner service exited during startup. Check {} for details.",
                    service_log_path("python-service.err.log").display()
                ));
            }

            if Instant::now() + interval >= deadline {
                return Err(
                    "Agent planner service did not become ready with LM Studio video/music capabilities. Stop the old service on 127.0.0.1:8000 and restart the app."
                        .to_string(),
                );
            }

            sleep(interval).await;
            interval = (interval * 2).min(MAX_POLL_INTERVAL);
        }
    }

    fn has_live_managed_child(&self) -> bool {
        self.process
            .lock()
            .map(|mut guard| {
                guard
                    .as_mut()
                    .map(|child| matches!(child.try_wait(), Ok(None)))
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    }

    fn managed_child_exited(&self) -> bool {
        self.process
            .lock()
            .map(|mut guard| {
                guard
                    .as_mut()
                    .map(|child| matches!(child.try_wait(), Ok(Some(_))))
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    }

    fn mark_service_healthy(&self) {
        if let Ok(mut cache) = self.health_cache.lock() {
            cache.service = Some(Instant::now());
        }
    }

    fn service_health_fresh(&self) -> bool {
        self.health_cache
            .lock()
            .map(|cache| cache.service.is_some_and(|at| at.elapsed() < HEALTH_CACHE_TTL))
            .unwrap_or(false)
    }

    fn mark_agent_healthy(&self) {
        if let Ok(mut cache) = self.health_cache.lock() {
            cache.agent = Some(Instant::now());
        }
    }

    fn agent_health_fresh(&self) -> bool {
        self.health_cache
            .lock()
            .map(|cache| cache.agent.is_some_and(|at| at.elapsed() < HEALTH_CACHE_TTL))
            .unwrap_or(false)
    }

    fn invalidate_health_cache(&self) {
        if let Ok(mut cache) = self.health_cache.lock() {
            *cache = HealthCache::default();
        }
    }
}

fn is_supported_agent_health(health: &AgentHealthResponse) -> bool {
    if health.status != "ready" {
        return false;
    }

    if health.planner_version.as_deref() != Some(REQUIRED_AGENT_PLANNER_VERSION) {
        return false;
    }

    REQUIRED_AGENT_CAPABILITIES
        .iter()
        .all(|capability| health.capabilities.iter().any(|value| value == capability))
}

#[cfg(windows)]
fn configure_music_service_process(command: &mut Command) {
    command.creation_flags(windows_process_creation_flags());
}

#[cfg(not(windows))]
fn configure_music_service_process(_command: &mut Command) {}

#[cfg(windows)]
fn windows_process_creation_flags() -> u32 {
    CREATE_NO_WINDOW
}

// `uv run` wraps the actual Python process, so killing only the wrapper would
// leave the service alive holding port 8000. taskkill /T takes down the whole
// tree; wait() afterwards reaps the wrapper.
fn terminate_child_tree(child: &mut Child) {
    let pid = child.id();

    #[cfg(windows)]
    {
        let killed = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map(|status| status.success())
            .unwrap_or(false);

        if !killed {
            let _ = child.kill();
        }
    }

    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }

    let _ = child.wait();
}

fn service_log_streams() -> (Stdio, Stdio) {
    let log_dir = service_log_dir();
    let _ = std::fs::create_dir_all(&log_dir);

    let open = |name: &str| {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_dir.join(name))
            .map(Stdio::from)
            .unwrap_or(Stdio::null())
    };

    (open("python-service.out.log"), open("python-service.err.log"))
}

fn service_log_dir() -> PathBuf {
    // Same base directory the app database uses (see db.rs).
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("tauri-eeg")
        .join("logs")
}

fn service_log_path(name: &str) -> PathBuf {
    service_log_dir().join(name)
}

fn music_service_dir() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let service_dir = manifest_dir
        .parent()
        .ok_or_else(|| "Failed to resolve project directory.".to_string())?
        .join("music-service");

    if !service_dir.is_dir() {
        return Err(format!(
            "Music service directory was not found at {}.",
            service_dir.display()
        ));
    }

    Ok(service_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_music_service_dir_from_tauri_manifest_dir() {
        let service_dir = music_service_dir().expect("music service directory should resolve");

        assert!(service_dir.ends_with("music-service"));
        assert!(service_dir.join("server.py").is_file());
        assert!(service_dir.join("pyproject.toml").is_file());
    }

    #[cfg(windows)]
    #[test]
    fn hides_music_service_console_window_on_windows() {
        assert_eq!(windows_process_creation_flags(), 0x08000000);
    }

    #[test]
    fn builds_agent_health_url_without_music_model_health_endpoint() {
        let manager = PythonServiceManager::new();

        assert_eq!(manager.agent_health_url(), "http://127.0.0.1:8000/agent/health");
    }

    #[test]
    fn accepts_agent_health_only_when_lm_planner_capabilities_are_present() {
        let health = AgentHealthResponse {
            status: "ready".to_string(),
            planner_version: Some("lm-video-music-stream-v1".to_string()),
            capabilities: vec![
                "lm_video_selection".to_string(),
                "lm_music_generation_prompt".to_string(),
                "lm_planner_streaming".to_string(),
            ],
        };

        assert!(is_supported_agent_health(&health));
    }

    #[test]
    fn rejects_legacy_agent_health_without_versioned_capabilities() {
        let health = AgentHealthResponse {
            status: "ready".to_string(),
            planner_version: None,
            capabilities: vec![],
        };

        assert!(!is_supported_agent_health(&health));
    }
}

impl Drop for PythonServiceManager {
    fn drop(&mut self) {
        if Arc::strong_count(&self.process) != 1 {
            return;
        }

        if let Ok(mut process_guard) = self.process.lock() {
            if let Some(mut child) = process_guard.take() {
                terminate_child_tree(&mut child);
            }
        }
    }
}
