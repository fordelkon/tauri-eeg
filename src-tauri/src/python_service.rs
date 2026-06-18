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
pub struct PythonServiceManager {
    process: Arc<Mutex<Option<Child>>>,
    base_url: String,
}

impl PythonServiceManager {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            base_url: "http://127.0.0.1:8000".to_string(),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn ensure_running(&self) -> Result<(), String> {
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
            .map_err(|_| "Python service state is unavailable.".to_string())?;

        if process_guard.is_some() {
            return Ok(());
        }

        let service_dir = music_service_dir()?;

        let mut command = Command::new("uv");
        command
            .current_dir(service_dir)
            .args(["run", "python", "server.py"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        configure_music_service_process(&mut command);

        let child = command
            .spawn()
            .map_err(|_| "Failed to start music generation service. Ensure uv is installed and music-service is set up.".to_string())?;

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
        for _ in 0..30 {
            if self.is_healthy().await {
                return Ok(());
            }

            sleep(Duration::from_secs(1)).await;
        }

        Err("Music generation service did not become ready.".to_string())
    }
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
}

impl Drop for PythonServiceManager {
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
