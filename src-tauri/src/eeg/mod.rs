pub mod buffer;
pub mod paradigm;
pub mod paradigm_controller;
pub mod paradigm_db;
pub mod paradigm_rules;
pub mod paradigm_video;
pub mod protocol;
pub mod server;
pub mod session;
pub mod storage;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
    Arc, Mutex,
};
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

pub use paradigm::{
    BeginEegTrialInput, FinalizeEegTrialInput, MarkEegTrialInput, ParadigmQueueInput,
    ParadigmSessionSummary, ParadigmSummaryInput, ParadigmTrialPlanItem, ParadigmVideoLibrary,
    ParadigmVideoLibraryInput, TrialRecord, TrialSnapshot,
};
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
    inner: Arc<EegSharedState>,
}

/// The mutex-guarded runtime plus the lock-free ingest signals behind one Arc,
/// so TCP ingest threads and IPC commands share both halves.
#[derive(Default)]
pub(crate) struct EegSharedState {
    pub(crate) runtime: Mutex<EegRuntime>,
    pub(crate) signals: EegSignals,
}

/// Hot-path state kept outside the runtime mutex so the 1000 Hz sample loop
/// and per-packet bookkeeping never queue behind UI/status commands.
#[derive(Default)]
pub(crate) struct EegSignals {
    /// Latest hardware trigger code awaiting attachment to the next sample.
    /// The protocol filters zero triggers before they get here, so 0 doubles
    /// as "none pending" and take() is a single atomic swap.
    latest_trigger: AtomicU8,
    /// Incremented whenever the recording worker is installed or removed;
    /// ingest threads cache the recording sender keyed on this generation, so
    /// start/stop pays one mutex round-trip instead of every sample.
    recording_generation: AtomicU64,
    /// Connection flags, written only under the runtime lock inside
    /// set_connection_state / stop_stream and read lock-free per packet.
    pub(crate) eeg_connected: AtomicBool,
    pub(crate) trigger_connected: AtomicBool,
}

impl EegSignals {
    pub(crate) fn store_latest_trigger(&self, value: u8) {
        self.latest_trigger.store(value, Ordering::Release);
    }

    pub(crate) fn take_latest_trigger(&self) -> Option<u8> {
        match self.latest_trigger.swap(0, Ordering::AcqRel) {
            0 => None,
            value => Some(value),
        }
    }

    /// Must run in the same critical section that installs/removes
    /// runtime.recording so ingest-side sender caches re-resolve promptly.
    pub(crate) fn bump_recording_generation(&self) {
        self.recording_generation.fetch_add(1, Ordering::Release);
    }
}

pub(crate) struct EegRuntime {
    pub(crate) config: Option<Arc<EegStreamConfig>>,
    pub(crate) worker: Option<server::EegServerWorker>,
    pub(crate) recording: Option<RecordingWorker>,
    pub(crate) paradigm: Option<paradigm_controller::ParadigmController>,
    pub(crate) last_recording: Option<EegRecordingSession>,
    pub(crate) sample_channel: Option<Channel<InvokeResponseBody>>,
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
            paradigm: None,
            last_recording: None,
            sample_channel: None,
            last_error: None,
            last_disconnect_reason: None,
            padded_samples: 0,
            pending_status_events: Vec::new(),
        }
    }
}

impl EegRuntime {
    pub(crate) fn recording_sender(
        &self,
    ) -> Option<std::sync::mpsc::Sender<storage::RecordingMessage>> {
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
    let mut runtime = state.inner.runtime.lock().map_err(eeg_state_unavailable)?;
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
    conn: Arc<Mutex<Connection>>,
) -> Result<(), String> {
    if let Some(finished) = stop_active_recording(state)? {
        // The writer thread has already been joined and the binary files
        // flushed (see stop_active_recording), so the DB mutex below is only
        // ever held for the fast INSERTs.
        let conn = conn
            .lock()
            .map_err(|_| "Database is unavailable.".to_string())?;
        persist_recording(&conn, state, finished)?;
    }

    let worker = {
        let mut runtime = state
            .inner
            .runtime
            .lock()
            .map_err(|_| "EEG stream state is unavailable.".to_string())?;
        runtime.config = None;
        runtime.sample_channel = None;
        // Same critical section as before: late packets from a dying
        // connection must not re-mark the devices connected after the stream
        // is gone.
        state.inner.signals.eeg_connected.store(false, Ordering::Release);
        state
            .inner
            .signals
            .trigger_connected
            .store(false, Ordering::Release);
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
        .runtime
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
        eeg_connected: state.inner.signals.eeg_connected.load(Ordering::Acquire),
        trigger_connected: state.inner.signals.trigger_connected.load(Ordering::Acquire),
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
            .runtime
            .lock()
            .map_err(|_| "EEG stream state is unavailable.".to_string())?;
        validate_recording_ready(
            runtime.worker.is_some(),
            state.inner.signals.eeg_connected.load(Ordering::Acquire),
            runtime.recording.is_some(),
        )?;
        runtime
            .config
            .as_ref()
            .map(|config| (**config).clone())
            .unwrap_or_default()
    };

    let base_dir = crate::storage_paths::eeg_recordings_root(app)?;
    let paradigm = input.paradigm.clone();
    let writer = storage::RecordingWriter::start(conn, &base_dir, input, &config)?;
    let session = writer.session();
    let worker = RecordingWorker::start(writer);
    let controller = paradigm.map(|info| {
        let controller = paradigm_controller::ParadigmController::new(
            info,
            session.id.clone(),
            session.session_dir.clone(),
            session.sample_rate_hz,
            session.channel_count,
            worker.sender(),
            worker.sample_count_handle(),
            worker.trigger_observations_handle(),
        );
        controller.emit_session_started();
        controller
    });

    let mut runtime = state
        .inner
        .runtime
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())?;
    runtime.recording = Some(worker);
    runtime.paradigm = controller;
    // Publish the new sender to the ingest threads in the same critical
    // section: once this returns, samples must reach the recorder.
    state.inner.signals.bump_recording_generation();
    Ok(session)
}

/// A recording that has been fully stopped on disk: the writer thread was
/// joined (flushing the session's binary files) and everything needed for the
/// database write is collected. Produced without holding the DB mutex so the
/// potentially long file flush never blocks other database users.
pub struct FinishedRecording {
    session: EegRecordingSession,
    records: Vec<TrialRecord>,
}

/// Stops the active recording without touching the database: interrupts any
/// active paradigm trial, joins the recording writer thread — which flushes
/// the whole session's binary files — and returns the finished recording.
/// Call this BEFORE acquiring the global DB connection mutex; follow up with
/// [`persist_recording`] while holding the lock.
pub fn stop_recording(state: &EegStreamState) -> Result<FinishedRecording, String> {
    stop_active_recording(state)?.ok_or_else(|| "No EEG recording is active.".to_string())
}

/// `stop_recording`'s non-failing variant for flows where "nothing was
/// recording" is not an error (e.g. stopping the whole stream).
fn stop_active_recording(
    state: &EegStreamState,
) -> Result<Option<FinishedRecording>, String> {
    let Some((worker, records)) = halt_recording(state)? else {
        return Ok(None);
    };
    let session = worker.stop()?;
    Ok(Some(FinishedRecording { session, records }))
}

/// Writes a [`FinishedRecording`] to the database. The caller must already
/// hold the DB connection lock and the flush must have completed
/// ([`stop_recording`]), so this only performs the fast INSERTs. The session
/// row is inserted first, then all trial rows in a single transaction (they
/// reference the session row); the finished session is published to the
/// runtime only after the writes succeed.
pub fn persist_recording(
    conn: &Connection,
    state: &EegStreamState,
    finished: FinishedRecording,
) -> Result<EegRecordingSession, String> {
    let FinishedRecording { session, records } = finished;
    storage::insert_eeg_session(conn, &session)?;
    // One transaction for all trial rows: per-row implicit transactions would
    // fsync WAL once per INSERT while the global DB mutex is held.
    let tx = conn
        .unchecked_transaction()
        .map_err(|_| "Failed to save EEG trials.".to_string())?;
    for record in &records {
        paradigm_db::insert_eeg_trial(&tx, record, &session.user_id)?;
    }
    tx.commit()
        .map_err(|_| "Failed to save EEG trials.".to_string())?;
    let mut runtime = state
        .inner
        .runtime
        .lock()
        .map_err(|_| "EEG stream state is unavailable.".to_string())?;
    runtime.last_recording = Some(session.clone());
    Ok(session)
}

/// Takes the recording worker and paradigm controller out of the runtime,
/// interrupts the active trial, and sends the training manifest before any
/// sender is dropped (the writer thread must still be alive to receive it).
fn halt_recording(
    state: &EegStreamState,
) -> Result<Option<(RecordingWorker, Vec<TrialRecord>)>, String> {
    let (worker, controller) = {
        let mut runtime = state
            .inner
            .runtime
            .lock()
            .map_err(|_| "EEG stream state is unavailable.".to_string())?;
        let taken = (runtime.recording.take(), runtime.paradigm.take());
        // Invalidate the ingest-side sender caches right away so their stale
        // clones drop on the next sample instead of pinning the writer's
        // channel open past the stop below.
        state.inner.signals.bump_recording_generation();
        taken
    };
    let Some(worker) = worker else {
        return Ok(None);
    };

    let mut records = Vec::new();
    if let Some(mut controller) = controller {
        controller.interrupt();
        records = controller.take_all();
        let summary = paradigm_rules::summarize_trials(controller.session_id(), &records);
        if let Ok(manifest) = serde_json::to_string_pretty(&summary) {
            let _ = worker
                .sender()
                .send(storage::RecordingMessage::Manifest(manifest));
        }
    }
    Ok(Some((worker, records)))
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
