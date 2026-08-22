pub mod buffer;
pub mod protocol;
pub mod server;
pub mod session;
pub mod storage;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Emitter,
};

pub const DEFAULT_SAMPLE_RATE_HZ: u32 = 1000;
pub const DEFAULT_BLOCK_INTERVAL_MS: u64 = 50;
const DEFAULT_BIND_HOST: &str = "192.168.1.101";
const DEFAULT_TCP_PORT: u16 = 5001;
const DEFAULT_DEVICE_HOST: &str = "192.168.1.102";
const DEFAULT_DEVICE_UDP_PORT: u16 = 8080;
const DEFAULT_EEG_DEVICE_IP: &str = "192.168.1.102";
const DEFAULT_TRIGGER_DEVICE_IP: &str = "192.168.1.103";

pub use session::{EegRecordingSession, EegStatus, EegStatusEvent, StartEegRecordingInput};
use storage::RecordingWorker;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EegStreamConfig {
    #[serde(default = "default_bind_host")]
    pub bind_host: String,
    #[serde(default = "default_tcp_port")]
    pub tcp_port: u16,
    #[serde(default = "default_device_host")]
    pub device_host: String,
    #[serde(default = "default_device_udp_port")]
    pub device_udp_port: u16,
    #[serde(default = "default_eeg_device_ip")]
    pub eeg_device_ip: String,
    #[serde(default = "default_trigger_device_ip")]
    pub trigger_device_ip: String,
    #[serde(default = "default_sample_rate_hz")]
    pub sample_rate_hz: u32,
    #[serde(default = "default_block_interval_ms")]
    pub block_interval_ms: u64,
}

fn default_bind_host() -> String {
    DEFAULT_BIND_HOST.to_string()
}

fn default_tcp_port() -> u16 {
    DEFAULT_TCP_PORT
}

fn default_device_host() -> String {
    DEFAULT_DEVICE_HOST.to_string()
}

fn default_device_udp_port() -> u16 {
    DEFAULT_DEVICE_UDP_PORT
}

fn default_eeg_device_ip() -> String {
    DEFAULT_EEG_DEVICE_IP.to_string()
}

fn default_trigger_device_ip() -> String {
    DEFAULT_TRIGGER_DEVICE_IP.to_string()
}

fn default_sample_rate_hz() -> u32 {
    DEFAULT_SAMPLE_RATE_HZ
}

fn default_block_interval_ms() -> u64 {
    DEFAULT_BLOCK_INTERVAL_MS
}

impl Default for EegStreamConfig {
    fn default() -> Self {
        Self {
            bind_host: default_bind_host(),
            tcp_port: default_tcp_port(),
            device_host: default_device_host(),
            device_udp_port: default_device_udp_port(),
            eeg_device_ip: default_eeg_device_ip(),
            trigger_device_ip: default_trigger_device_ip(),
            sample_rate_hz: default_sample_rate_hz(),
            block_interval_ms: default_block_interval_ms(),
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
    pub channel_ids: &'static [String],
}

#[derive(Clone, Default)]
pub struct EegStreamState {
    inner: Arc<Mutex<EegRuntime>>,
}

pub(crate) struct EegRuntime {
    pub(crate) config: Option<Arc<EegStreamConfig>>,
    pub(crate) worker: Option<server::EegServerWorker>,
    pub(crate) recording: Option<RecordingWorker>,
    pub(crate) last_recording: Option<EegRecordingSession>,
    pub(crate) sample_channel: Option<Channel<InvokeResponseBody>>,
    pub(crate) latest_trigger: Option<u8>,
    pub(crate) eeg_connected: bool,
    pub(crate) trigger_connected: bool,
    pub(crate) last_error: Option<String>,
    pub(crate) last_disconnect_reason: Option<String>,
    pub(crate) padded_samples: u64,
    pub(crate) pending_status_events: Vec<EegStatusEvent>,
}

impl Default for EegRuntime {
    fn default() -> Self {
        Self {
            config: None,
            worker: None,
            recording: None,
            last_recording: None,
            sample_channel: None,
            latest_trigger: None,
            eeg_connected: false,
            trigger_connected: false,
            last_error: None,
            last_disconnect_reason: None,
            padded_samples: 0,
            pending_status_events: Vec::new(),
        }
    }
}

impl EegRuntime {
    pub(crate) fn recording_sender(&self) -> Option<std::sync::mpsc::Sender<storage::RecordingSample>> {
        self.recording.as_ref().map(|worker| worker.sender())
    }
}

fn stream_info_from_config(config: &EegStreamConfig) -> EegStreamInfo {
    EegStreamInfo {
        bind_host: config.bind_host.clone(),
        tcp_port: config.tcp_port,
        sample_rate_hz: config.sample_rate_hz,
        block_interval_ms: config.block_interval_ms,
        channel_ids: buffer::shared_channel_ids(),
    }
}

pub fn start_stream(
    app: AppHandle,
    state: &EegStreamState,
    config: Option<EegStreamConfig>,
    on_sample_block: Channel<InvokeResponseBody>,
) -> Result<EegStreamInfo, String> {
    let mut runtime = state.inner.lock().map_err(eeg_state_unavailable)?;
    if let Some(existing) = runtime.config.clone() {
        server::send_start_instruction(&existing)?;
        runtime.sample_channel = Some(on_sample_block);
        return Ok(stream_info_from_config(&existing));
    }

    let config = Arc::new(config.unwrap_or_default());
    let worker = server::start_server(app, (*config).clone(), Arc::clone(&state.inner))?;
    if let Err(error) = server::send_start_instruction(&config) {
        worker.stop();
        return Err(error);
    }
    runtime.config = Some(Arc::clone(&config));
    runtime.worker = Some(worker);
    runtime.sample_channel = Some(on_sample_block);
    runtime.padded_samples = 0;
    runtime.last_disconnect_reason = None;
    Ok(stream_info_from_config(&config))
}

fn eeg_state_unavailable(
    _: std::sync::PoisonError<std::sync::MutexGuard<'_, EegRuntime>>,
) -> String {
    "EEG stream state is unavailable.".to_string()
}

pub fn stop_stream(
    app: &AppHandle,
    state: &EegStreamState,
    conn: &Connection,
) -> Result<(), String> {
    let recording = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "EEG stream state is unavailable.".to_string())?;
        runtime.recording.take()
    };

    if let Some(worker) = recording {
        let session = worker.stop()?;
        storage::insert_eeg_session(conn, &session)?;
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
        runtime.sample_channel = None;
        runtime.eeg_connected = false;
        runtime.trigger_connected = false;
        runtime.worker.take()
    };
    if let Some(worker) = worker {
        worker.stop();
    }

    let _ = app.emit(
        buffer::EEG_STATUS_EVENT,
        EegStatusEvent {
            client: session::EegStatusClient::Stream,
            connected: false,
            reason: Some("EEG stream stopped.".to_string()),
        },
    );
    Ok(())
}

pub fn get_status(state: &EegStreamState) -> Result<EegStatus, String> {
    let runtime = state
        .inner
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())?;
    let (sample_rate_hz, block_interval_ms) = runtime
        .config
        .as_ref()
        .map(|config| (config.sample_rate_hz, config.block_interval_ms))
        .unwrap_or((DEFAULT_SAMPLE_RATE_HZ, DEFAULT_BLOCK_INTERVAL_MS));

    Ok(EegStatus {
        is_streaming: runtime.worker.is_some(),
        is_recording: runtime.recording.is_some(),
        eeg_connected: runtime.eeg_connected,
        trigger_connected: runtime.trigger_connected,
        last_error: runtime.last_error.clone(),
        last_disconnect_reason: runtime.last_disconnect_reason.clone(),
        sample_rate_hz,
        block_interval_ms,
        channel_ids: buffer::shared_channel_ids(),
        padded_samples: runtime.padded_samples,
        active_recording: runtime.recording.as_ref().map(|worker| worker.session()),
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
        runtime
            .config
            .as_ref()
            .map(|config| (**config).clone())
            .unwrap_or_default()
    };

    let base_dir = crate::storage_paths::eeg_recordings_root(app)?;
    let writer = storage::RecordingWriter::start(conn, &base_dir, input, &config)?;
    let session = writer.session();

    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())?;
    runtime.recording = Some(RecordingWorker::start(writer));
    Ok(session)
}

pub fn stop_recording(
    conn: &Connection,
    state: &EegStreamState,
) -> Result<EegRecordingSession, String> {
    let worker = {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "EEG stream state is unavailable.".to_string())?;
        runtime.recording.take()
    }
    .ok_or_else(|| "No EEG recording is active.".to_string())?;

    let session = worker.stop()?;
    storage::insert_eeg_session(conn, &session)?;
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

    #[test]
    fn stream_config_deserializes_partial_overrides() {
        let config: EegStreamConfig =
            serde_json::from_str(r#"{"sampleRateHz": 500}"#).expect("partial config");

        assert_eq!(config.sample_rate_hz, 500);
        assert_eq!(config.bind_host, DEFAULT_BIND_HOST);
        assert_eq!(config.tcp_port, DEFAULT_TCP_PORT);
        assert_eq!(config.block_interval_ms, DEFAULT_BLOCK_INTERVAL_MS);
    }
}
