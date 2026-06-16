pub mod buffer;
pub mod protocol;
pub mod server;
pub mod session;
pub mod storage;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

pub const DEFAULT_SAMPLE_RATE_HZ: u32 = 1000;
pub const DEFAULT_BLOCK_INTERVAL_MS: u64 = 50;
const DEFAULT_BIND_HOST: &str = "192.168.1.101";
const DEFAULT_TCP_PORT: u16 = 5001;
const DEFAULT_DEVICE_HOST: &str = "192.168.1.102";
const DEFAULT_DEVICE_UDP_PORT: u16 = 8080;
const DEFAULT_EEG_DEVICE_IP: &str = "192.168.1.102";
const DEFAULT_TRIGGER_DEVICE_IP: &str = "192.168.1.103";

pub use session::{EegRecordingSession, EegStatus, StartEegRecordingInput};
use storage::RecordingWriter;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EegStreamConfig {
    pub bind_host: String,
    pub tcp_port: u16,
    pub device_host: String,
    pub device_udp_port: u16,
    pub eeg_device_ip: String,
    pub sample_rate_hz: u32,
    pub block_interval_ms: u64,
    pub trigger_device_ip: String,
}

impl Default for EegStreamConfig {
    fn default() -> Self {
        Self {
            bind_host: DEFAULT_BIND_HOST.to_string(),
            tcp_port: DEFAULT_TCP_PORT,
            device_host: DEFAULT_DEVICE_HOST.to_string(),
            device_udp_port: DEFAULT_DEVICE_UDP_PORT,
            eeg_device_ip: DEFAULT_EEG_DEVICE_IP.to_string(),
            trigger_device_ip: DEFAULT_TRIGGER_DEVICE_IP.to_string(),
            sample_rate_hz: DEFAULT_SAMPLE_RATE_HZ,
            block_interval_ms: DEFAULT_BLOCK_INTERVAL_MS,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EegStreamInfo {
    pub bind_host: String,
    pub tcp_port: u16,
    pub sample_rate_hz: u32,
    pub block_interval_ms: u64,
    pub channel_ids: Vec<String>,
}

#[derive(Default)]
pub struct EegStreamState {
    inner: Arc<Mutex<EegRuntime>>,
}

pub(crate) struct EegRuntime {
    pub(crate) config: Option<EegStreamConfig>,
    pub(crate) worker: Option<server::EegServerWorker>,
    pub(crate) recording: Option<RecordingWriter>,
    pub(crate) last_recording: Option<EegRecordingSession>,
    pub(crate) latest_trigger: Option<u8>,
    pub(crate) eeg_connected: bool,
    pub(crate) trigger_connected: bool,
    pub(crate) last_error: Option<String>,
}

impl Default for EegRuntime {
    fn default() -> Self {
        Self {
            config: None,
            worker: None,
            recording: None,
            last_recording: None,
            latest_trigger: None,
            eeg_connected: false,
            trigger_connected: false,
            last_error: None,
        }
    }
}

fn stream_info_from_config(config: &EegStreamConfig) -> EegStreamInfo {
    EegStreamInfo {
        bind_host: config.bind_host.clone(),
        tcp_port: config.tcp_port,
        sample_rate_hz: config.sample_rate_hz,
        block_interval_ms: config.block_interval_ms,
        channel_ids: buffer::default_channel_ids(),
    }
}

pub fn start_stream(
    app: AppHandle,
    state: &EegStreamState,
    config: Option<EegStreamConfig>,
) -> Result<EegStreamInfo, String> {
    let config = config.unwrap_or_default();
    let mut runtime = state.inner.lock().map_err(eeg_state_unavailable)?;
    if let Some(existing) = runtime.config.clone() {
        server::send_start_instruction(&existing)?;
        return Ok(stream_info_from_config(&existing));
    }

    let worker = server::start_server(app, config.clone(), Arc::clone(&state.inner))?;
    if let Err(error) = server::send_start_instruction(&config) {
        worker.stop();
        return Err(error);
    }
    runtime.config = Some(config.clone());
    runtime.worker = Some(worker);
    Ok(stream_info_from_config(&config))
}

fn eeg_state_unavailable(
    _: std::sync::PoisonError<std::sync::MutexGuard<'_, EegRuntime>>,
) -> String {
    "EEG stream state is unavailable.".to_string()
}

pub fn stop_stream(state: &EegStreamState, conn: &Connection) -> Result<(), String> {
    let recording = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "EEG stream state is unavailable.".to_string())?;
        runtime.recording.take()
    };

    if let Some(writer) = recording {
        let session = writer.finish(conn)?;
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "EEG stream state is unavailable.".to_string())?;
        runtime.last_recording = Some(session);
    }

    let worker = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "EEG stream state is unavailable.".to_string())?;
        runtime.config = None;
        runtime.eeg_connected = false;
        runtime.trigger_connected = false;
        runtime.worker.take()
    };
    if let Some(worker) = worker {
        worker.stop();
    }
    Ok(())
}

pub fn get_status(state: &EegStreamState) -> Result<EegStatus, String> {
    let runtime = state
        .inner
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())?;
    let config = runtime.config.clone().unwrap_or_default();

    Ok(EegStatus {
        is_streaming: runtime.worker.is_some(),
        is_recording: runtime.recording.is_some(),
        eeg_connected: runtime.eeg_connected,
        trigger_connected: runtime.trigger_connected,
        last_error: runtime.last_error.clone(),
        sample_rate_hz: config.sample_rate_hz,
        block_interval_ms: config.block_interval_ms,
        channel_ids: buffer::default_channel_ids(),
        active_recording: runtime.recording.as_ref().map(|writer| writer.session()),
    })
}

pub fn start_recording(
    app: &AppHandle,
    conn: &Connection,
    state: &EegStreamState,
    input: StartEegRecordingInput,
) -> Result<EegRecordingSession, String> {
    let config = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "EEG stream state is unavailable.".to_string())?;
        validate_recording_ready(
            runtime.worker.is_some(),
            runtime.eeg_connected,
            runtime.recording.is_some(),
        )?;
        runtime.config.clone().unwrap_or_default()
    };

    let base_dir = crate::storage_paths::eeg_recordings_root(app)?;
    let writer = RecordingWriter::start(conn, &base_dir, input, &config)?;
    let session = writer.session();

    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())?;
    runtime.recording = Some(writer);
    Ok(session)
}

pub fn stop_recording(
    conn: &Connection,
    state: &EegStreamState,
) -> Result<EegRecordingSession, String> {
    let writer = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "EEG stream state is unavailable.".to_string())?;
        runtime.recording.take()
    }
    .ok_or_else(|| "No EEG recording is active.".to_string())?;

    let session = writer.finish(conn)?;
    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())?;
    runtime.last_recording = Some(session.clone());
    Ok(session)
}

pub fn list_sessions(conn: &Connection, user_id: &str) -> Result<Vec<EegRecordingSession>, String> {
    storage::list_eeg_sessions(conn, user_id)
}

fn validate_recording_ready(
    is_streaming: bool,
    eeg_connected: bool,
    is_recording: bool,
) -> Result<(), String> {
    if !is_streaming {
        return Err("Start EEG stream before recording.".to_string());
    }
    if !eeg_connected {
        return Err("Wait for valid EEG data before recording.".to_string());
    }
    if is_recording {
        return Err("EEG recording is already active.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recording_requires_valid_eeg_data_after_stream_start() {
        assert_eq!(
            validate_recording_ready(false, false, false),
            Err("Start EEG stream before recording.".to_string())
        );
        assert_eq!(
            validate_recording_ready(true, false, false),
            Err("Wait for valid EEG data before recording.".to_string())
        );
        assert_eq!(
            validate_recording_ready(true, true, true),
            Err("EEG recording is already active.".to_string())
        );
        assert_eq!(validate_recording_ready(true, true, false), Ok(()));
    }
}
