use std::{
    io::Read,
    net::{IpAddr, TcpListener, TcpStream, UdpSocket},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tauri::{ipc::InvokeResponseBody, AppHandle, Emitter};

use super::{
    buffer::{RealtimeBlockAggregator, EEG_STATUS_EVENT},
    protocol::{
        PacketContinuity, PacketLossTracker, ParsedFrame, ProtocolParser, EEG_CHANNEL_COUNT,
        START_INSTRUCTION,
    },
    session::{EegStatusClient, EegStatusEvent},
    storage::RecordingMessage,
    EegSharedState, EegStreamConfig,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientKind {
    Eeg,
    Trigger,
}

impl ClientKind {
    fn device_label(self) -> &'static str {
        match self {
            ClientKind::Eeg => "EEG device",
            ClientKind::Trigger => "Trigger device",
        }
    }

    fn status_client(self) -> EegStatusClient {
        match self {
            ClientKind::Eeg => EegStatusClient::Eeg,
            ClientKind::Trigger => EegStatusClient::Trigger,
        }
    }
}

pub struct EegServerWorker {
    stop_requested: Arc<AtomicBool>,
    join_handle: Option<JoinHandle<()>>,
    client_handles: Arc<Mutex<Vec<JoinHandle<()>>>>,
}

impl EegServerWorker {
    pub fn stop(mut self) {
        self.stop_requested.store(true, Ordering::Relaxed);
        if let Some(join_handle) = self.join_handle.take() {
            let _ = join_handle.join();
        }
        if let Ok(mut client_handles) = self.client_handles.lock() {
            for handle in client_handles.drain(..) {
                let _ = handle.join();
            }
        }
    }
}

pub fn send_start_instruction(config: &EegStreamConfig) -> Result<(), String> {
    let socket = UdpSocket::bind(format!("{}:0", config.bind_host))
        .or_else(|_| UdpSocket::bind("0.0.0.0:0"))
        .map_err(|_| "Failed to open EEG UDP start socket.".to_string())?;
    socket
        .set_broadcast(true)
        .map_err(|_| "Failed to enable EEG UDP broadcast.".to_string())?;

    let broadcast = subnet_broadcast(&config.bind_host);
    for target in [
        broadcast.as_str(),
        config.device_host.as_str(),
        config.eeg_device_ip.as_str(),
        config.trigger_device_ip.as_str(),
    ] {
        socket
            .send_to(
                &START_INSTRUCTION,
                format!("{target}:{}", config.device_udp_port),
            )
            .map_err(|_| "Failed to send EEG device start instruction.".to_string())?;
    }

    Ok(())
}

pub fn classify_client(config: &EegStreamConfig, ip: IpAddr) -> Option<ClientKind> {
    let ip = ip.to_string();
    if ip == config.eeg_device_ip {
        Some(ClientKind::Eeg)
    } else if ip == config.trigger_device_ip {
        Some(ClientKind::Trigger)
    } else {
        None
    }
}

pub fn start_server(
    app: AppHandle,
    config: EegStreamConfig,
    state: Arc<EegSharedState>,
) -> Result<EegServerWorker, String> {
    let listener = TcpListener::bind(format!("{}:{}", config.bind_host, config.tcp_port))
        .map_err(|_| "Failed to bind EEG TCP server.".to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "Failed to configure EEG TCP server.".to_string())?;

    let stop_requested = Arc::new(AtomicBool::new(false));
    let client_handles = Arc::new(Mutex::new(Vec::new()));
    let stop_for_thread = Arc::clone(&stop_requested);
    let client_handles_for_thread = Arc::clone(&client_handles);
    let join_handle = thread::spawn(move || {
        while !stop_for_thread.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, addr)) => {
                    let Some(kind) = classify_client(&config, addr.ip()) else {
                        record_error(
                            &state,
                            format!("Rejected unknown EEG client at {}.", addr.ip()),
                        );
                        continue;
                    };
                    let app = app.clone();
                    let config = config.clone();
                    let state = Arc::clone(&state);
                    let stop = Arc::clone(&stop_for_thread);
                    let handle = thread::spawn(move || {
                        handle_stream(app, config, state, stop, kind, stream)
                    });
                    if let Ok(mut handles) = client_handles_for_thread.lock() {
                        handles.push(handle);
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(20));
                }
                Err(_) => break,
            }
        }
    });

    Ok(EegServerWorker {
        stop_requested,
        join_handle: Some(join_handle),
        client_handles,
    })
}

fn handle_stream(
    app: AppHandle,
    config: EegStreamConfig,
    state: Arc<EegSharedState>,
    stop_requested: Arc<AtomicBool>,
    kind: ClientKind,
    mut stream: TcpStream,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
    let mut parser = ProtocolParser::new();
    let mut aggregator =
        match RealtimeBlockAggregator::new(config.sample_rate_hz, config.block_interval_ms) {
            Ok(aggregator) => aggregator,
            Err(_) => return,
        };
    let mut eeg_tracker = PacketLossTracker::new();
    let mut trigger_tracker = PacketLossTracker::new();
    let mut last_sample = [0.0_f32; EEG_CHANNEL_COUNT];
    let mut buffer = [0_u8; 4096];
    let mut disconnect_reason: Option<String> = None;
    let mut sender_cache = RecordingSenderCache::default();

    while !stop_requested.load(Ordering::Relaxed) {
        match stream.read(&mut buffer) {
            Ok(0) => {
                disconnect_reason =
                    Some(format!("{} closed the connection.", kind.device_label()));
                break;
            }
            Ok(read_count) => {

                // One wall-clock read per packet: the aggregator only uses it

                // for the stream-start latch / fallback, so per-sample calls

                // were pure overhead on the ingest hot path.

                let packet_time_ms = current_time_ms();

                for frame in parser.push_bytes(&buffer[..read_count]) {
                    match frame {
                        ParsedFrame::Trigger {
                            packet_index,
                            value,
                        } if kind == ClientKind::Trigger => {
                            if trigger_tracker.observe(packet_index) != PacketContinuity::Duplicate
                            {
                                confirm_client_data(&state, kind);
                                if value == 0 {
                                    continue;
                                }
                                state.signals.store_latest_trigger(value);
                            }
                        }
                        ParsedFrame::Eeg {
                            packet_index,
                            samples_uv,
                        } if kind == ClientKind::Eeg => {
                            match eeg_tracker.observe(packet_index) {
                                PacketContinuity::Duplicate => continue,
                                PacketContinuity::Missing(count) => {
                                    record_padded_samples(&state, count);
                                    for _ in 0..count {
                                        process_eeg_sample(
                                            &state,
                                            &mut sender_cache,
                                            &mut aggregator,
                                            last_sample,
                                            packet_time_ms,
                                        );
                                    }
                                }
                                PacketContinuity::First
                                | PacketContinuity::Sequential
                                | PacketContinuity::Reset => {}
                            }
                            confirm_client_data(&state, kind);
                            last_sample = samples_uv;
                            process_eeg_sample(
                                &state,
                                &mut sender_cache,
                                &mut aggregator,
                                samples_uv,
                                packet_time_ms,
                        );
                        }
                        _ => {}
                    }
                }
                drain_status_events(&app, &state);
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(error) => {
                let message = format!("{} connection error: {error}.", kind.device_label());
                record_error(&state, message.clone());
                disconnect_reason = Some(message);
                break;
            }
        }
    }
    let reason = if stop_requested.load(Ordering::Relaxed) {
        format!("{} disconnected: EEG stream stopped.", kind.device_label())
    } else {
        disconnect_reason
            .unwrap_or_else(|| format!("{} disconnected unexpectedly.", kind.device_label()))
    };
    set_connection_state(&state, kind, false, Some(reason));
    drain_status_events(&app, &state);
}

/// Per-connection cache of the active recording sender. The runtime mutex is
/// hit once per recording start/stop (generation change) instead of once per
/// sample; the cached clone drops as soon as a new generation invalidates it.
#[derive(Default)]
struct RecordingSenderCache {
    generation: u64,
    sender: Option<mpsc::Sender<RecordingMessage>>,
}

impl RecordingSenderCache {
    fn recording_sender(
        &mut self,
        state: &EegSharedState,
    ) -> Option<&mpsc::Sender<RecordingMessage>> {
        let generation = state.signals.recording_generation.load(Ordering::Acquire);
        if self.generation != generation {
            self.sender = state
                .runtime
                .lock()
                .ok()
                .and_then(|runtime| runtime.recording_sender());
            self.generation = generation;
        }
        self.sender.as_ref()
    }
}

fn confirm_client_data(state: &EegSharedState, kind: ClientKind) {
    // Lock-free fast path: the flag is only ever flipped under the runtime
    // lock (set_connection_state / stop_stream), so a stale Acquire read just
    // costs one extra transition attempt.
    let is_connected = match kind {
        ClientKind::Eeg => state.signals.eeg_connected.load(Ordering::Acquire),
        ClientKind::Trigger => state.signals.trigger_connected.load(Ordering::Acquire),
    };

    if !is_connected {
        set_connection_state(state, kind, true, None);
    }
}

fn process_eeg_sample(
    state: &EegSharedState,
    sender_cache: &mut RecordingSenderCache,
    aggregator: &mut RealtimeBlockAggregator,
    samples_uv: [f32; EEG_CHANNEL_COUNT],
    packet_time_ms: i64,
) {
    // Lock-free per sample: the trigger is one atomic swap and the recording
    // sender rides the generation-checked cache. Disk IO happens on the
    // dedicated recording writer thread; the runtime mutex is only touched
    // once per emitted block (send_sample_block).
    let trigger = state.signals.take_latest_trigger();
    if let Some(sender) = sender_cache.recording_sender(state) {
        let _ = sender.send(RecordingMessage::Sample {
            samples: samples_uv,
            trigger: trigger.unwrap_or(0) as i32,
        });
    }
    if let Some(block) = aggregator.push_sample(samples_uv, trigger, packet_time_ms) {
        send_sample_block(state, block);
    }
}

fn send_sample_block(state: &EegSharedState, block: Vec<u8>) {
    if let Ok(runtime) = state.runtime.lock() {
        if let Some(channel) = runtime.sample_channel.as_ref() {
            let _ = channel.send(InvokeResponseBody::Raw(block));
        }
    }
}

fn set_connection_state(
    state: &EegSharedState,
    kind: ClientKind,
    connected: bool,
    reason: Option<String>,
) {
    let flag = match kind {
        ClientKind::Eeg => &state.signals.eeg_connected,
        ClientKind::Trigger => &state.signals.trigger_connected,
    };
    // The flag store stays inside the runtime critical section so it cannot
    // interleave with stop_stream's reset of the same flags.
    if let Ok(mut runtime) = state.runtime.lock() {
        if flag.load(Ordering::Acquire) == connected {
            return;
        }
        flag.store(connected, Ordering::Release);
        if !connected {
            if let Some(reason) = &reason {
                runtime.last_disconnect_reason = Some(reason.clone());
            }
        }
        runtime.pending_status_events.push(EegStatusEvent {
            client: kind.status_client(),
            connected,
            reason,
        });
    }
}

fn drain_status_events(app: &AppHandle, state: &EegSharedState) {
    let events = match state.runtime.lock() {
        Ok(mut runtime) => std::mem::take(&mut runtime.pending_status_events),
        Err(_) => return,
    };
    for event in events {
        let _ = app.emit(EEG_STATUS_EVENT, event);
    }
}

fn record_error(state: &EegSharedState, message: String) {
    if let Ok(mut runtime) = state.runtime.lock() {
        runtime.last_error = Some(message);
    }
}

fn record_padded_samples(state: &EegSharedState, count: u32) {
    if let Ok(mut runtime) = state.runtime.lock() {
        runtime.padded_samples += count as u64;
    }
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn subnet_broadcast(host_ip: &str) -> String {
    let mut parts = host_ip.split('.').take(3).collect::<Vec<_>>();
    if parts.len() == 3 {
        parts.push("255");
        parts.join(".")
    } else {
        "255.255.255.255".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_configured_device_ips() {
        let config = EegStreamConfig::default();

        assert_eq!(
            classify_client(&config, "192.168.1.102".parse().expect("ip")),
            Some(ClientKind::Eeg)
        );
        assert_eq!(
            classify_client(&config, "192.168.1.103".parse().expect("ip")),
            Some(ClientKind::Trigger)
        );
        assert_eq!(
            classify_client(&config, "192.168.1.104".parse().expect("ip")),
            None
        );
    }

    #[test]
    fn derives_broadcast_from_fixed_host_ip() {
        assert_eq!(subnet_broadcast("192.168.1.101"), "192.168.1.255");
    }

    #[test]
    fn confirms_connection_only_after_client_data() {
        let state = Arc::new(EegSharedState::default());

        assert!(!state.signals.eeg_connected.load(Ordering::Acquire));
        assert!(!state.signals.trigger_connected.load(Ordering::Acquire));

        confirm_client_data(&state, ClientKind::Eeg);

        assert!(state.signals.eeg_connected.load(Ordering::Acquire));
        assert!(!state.signals.trigger_connected.load(Ordering::Acquire));

        confirm_client_data(&state, ClientKind::Trigger);

        assert!(state.signals.eeg_connected.load(Ordering::Acquire));
        assert!(state.signals.trigger_connected.load(Ordering::Acquire));
    }

    #[test]
    fn queues_status_event_and_disconnect_reason_when_connection_state_changes() {
        let state = Arc::new(EegSharedState::default());

        set_connection_state(&state, ClientKind::Eeg, true, None);
        set_connection_state(&state, ClientKind::Eeg, true, None);

        {
            let runtime = state.runtime.lock().expect("runtime");
            assert_eq!(runtime.pending_status_events.len(), 1);
            assert_eq!(
                runtime.pending_status_events[0],
                EegStatusEvent {
                    client: EegStatusClient::Eeg,
                    connected: true,
                    reason: None,
                }
            );
        }

        set_connection_state(&state, ClientKind::Eeg, false, Some("EEG device closed the connection.".to_string()));

        let runtime = state.runtime.lock().expect("runtime");
        assert_eq!(runtime.pending_status_events.len(), 2);
        assert!(!state.signals.eeg_connected.load(Ordering::Acquire));
        assert_eq!(
            runtime.last_disconnect_reason.as_deref(),
            Some("EEG device closed the connection.")
        );
    }

    #[test]
    fn tracks_padded_samples_from_packet_gaps() {
        let state = Arc::new(EegSharedState::default());

        record_padded_samples(&state, 3);
        record_padded_samples(&state, 2);

        let runtime = state.runtime.lock().expect("runtime");
        assert_eq!(runtime.padded_samples, 5);
    }
}
