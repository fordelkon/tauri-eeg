use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tokio::time::sleep;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone)]
pub struct NeuroMusicServiceManager {
    process: Arc<Mutex<Option<Child>>>,
    base_url: String,
}

impl NeuroMusicServiceManager {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            base_url: "http://127.0.0.1:8010".to_string(),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn ensure_running(&self) -> Result<(), String> {
        // Mirrors PythonServiceManager for Stable Audio, but keeps realtime
        // EEG emotion control isolated in its own Python service and port.
        if self.is_healthy().await {
            return Ok(());
        }

        self.start_service()?;
        self.wait_for_ready().await
    }

    fn start_service(&self) -> Result<(), String> {
        let mut process_guard = self
            .process
            .lock()
            .map_err(|_| "Neuro music service state is unavailable.".to_string())?;

        if process_guard.is_some() {
            return Ok(());
        }

        let service_dir = neuro_music_service_dir()?;

        let mut command = Command::new("uv");
        command
            .current_dir(service_dir)
            .args(["run", "python", "server.py"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        configure_neuro_music_service_process(&mut command);

        let child = command.spawn().map_err(|_| {
            "Failed to start realtime neuro music service. Ensure uv is installed and neuro-music-service is set up.".to_string()
        })?;

        *process_guard = Some(child);

        Ok(())
    }

    async fn is_healthy(&self) -> bool {
        let url = format!("{}/health", self.base_url);
        let client = reqwest::Client::new();

        client
            .get(url)
            .timeout(Duration::from_secs(2))
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false)
    }

    async fn wait_for_ready(&self) -> Result<(), String> {
        for _ in 0..15 {
            if self.is_healthy().await {
                return Ok(());
            }

            sleep(Duration::from_secs(1)).await;
        }

        Err("Realtime neuro music service did not become ready.".to_string())
    }
}

#[cfg(windows)]
fn configure_neuro_music_service_process(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_neuro_music_service_process(_command: &mut Command) {}

fn neuro_music_service_dir() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let service_dir = manifest_dir
        .parent()
        .ok_or_else(|| "Failed to resolve project directory.".to_string())?
        .join("neuro-music-service");

    if !service_dir.is_dir() {
        return Err(format!(
            "Neuro music service directory was not found at {}.",
            service_dir.display()
        ));
    }

    Ok(service_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_neuro_music_service_dir_from_tauri_manifest_dir() {
        let service_dir =
            neuro_music_service_dir().expect("neuro music service directory should resolve");

        assert!(service_dir.ends_with("neuro-music-service"));
        assert!(service_dir.join("server.py").is_file());
        assert!(service_dir.join("pyproject.toml").is_file());
    }
}

impl Drop for NeuroMusicServiceManager {
    fn drop(&mut self) {
        if Arc::strong_count(&self.process) != 1 {
            return;
        }

        if let Ok(mut process_guard) = self.process.lock() {
            if let Some(mut child) = process_guard.take() {
                let _ = child.kill();
            }
        }
    }
}
