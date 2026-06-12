use std::{
    io::Read,
    net::{IpAddr, TcpListener, TcpStream, UdpSocket},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Emitter};

use super::{
    buffer::{EegSampleBlockPayload, RealtimeBlockAggregator, EEG_SAMPLE_BLOCK_EVENT},
    protocol::{
        PacketContinuity, PacketLossTracker, ParsedFrame, ProtocolParser, EEG_CHANNEL_COUNT,
        START_INSTRUCTION,
    },
    EegRuntime, EegStreamConfig,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientKind {
    Eeg,
    Trigger,
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
    runtime: Arc<Mutex<EegRuntime>>,
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
                            &runtime,
                            format!("Rejected unknown EEG client at {}.", addr.ip()),
                        );
                        continue;
                    };
                    let app = app.clone();
                    let config = config.clone();
                    let runtime = Arc::clone(&runtime);
                    let stop = Arc::clone(&stop_for_thread);
                    let handle = thread::spawn(move || {
                        handle_stream(app, config, runtime, stop, kind, stream)
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
    runtime: Arc<Mutex<EegRuntime>>,
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

    while !stop_requested.load(Ordering::Relaxed) {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(read_count) => {
                for frame in parser.push_bytes(&buffer[..read_count]) {
                    match frame {
                        ParsedFrame::Trigger {
                            packet_index,
                            value,
                        } if kind == ClientKind::Trigger => {
                            if trigger_tracker.observe(packet_index) != PacketContinuity::Duplicate
                            {
                                confirm_client_data(&runtime, kind);
                                if value == 0 {
                                    continue;
                                }
                                set_latest_trigger(&runtime, value);
                            }
                        }
                        ParsedFrame::Eeg {
                            packet_index,
                            samples_uv,
                        } if kind == ClientKind::Eeg => {
                            match eeg_tracker.observe(packet_index) {
                                PacketContinuity::Duplicate => continue,
                                PacketContinuity::Missing(count) => {
                                    for _ in 0..count {
                                        process_eeg_sample(
                                            &app,
                                            &runtime,
                                            &mut aggregator,
                                            last_sample,
                                        );
                                    }
                                }
                                PacketContinuity::First
                                | PacketContinuity::Sequential
                                | PacketContinuity::Reset => {}
                            }
                            confirm_client_data(&runtime, kind);
                            last_sample = samples_uv;
                            process_eeg_sample(&app, &runtime, &mut aggregator, samples_uv);
                        }
                        _ => {}
                    }
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(error) => {
                record_error(&runtime, format!("{kind:?} EEG socket error: {error}."));
                break;
            }
        }
    }
    set_connection_state(&runtime, kind, false);
}

fn confirm_client_data(runtime: &Arc<Mutex<EegRuntime>>, kind: ClientKind) {
    let is_connected = runtime
        .lock()
        .map(|runtime| match kind {
            ClientKind::Eeg => runtime.eeg_connected,
            ClientKind::Trigger => runtime.trigger_connected,
        })
        .unwrap_or(false);

    if !is_connected {
        set_connection_state(runtime, kind, true);
    }
}

fn process_eeg_sample(
    app: &AppHandle,
    runtime: &Arc<Mutex<EegRuntime>>,
    aggregator: &mut RealtimeBlockAggregator,
    samples_uv: [f32; EEG_CHANNEL_COUNT],
) {
    let trigger = take_latest_trigger(runtime);
    write_recording_sample(runtime, &samples_uv, trigger.unwrap_or(0) as i32);
    if let Some(block) = aggregator.push_sample(samples_uv, trigger, current_time_ms()) {
        emit_block(app, block);
    }
}

fn set_latest_trigger(runtime: &Arc<Mutex<EegRuntime>>, trigger: u8) {
    if let Ok(mut runtime) = runtime.lock() {
        runtime.latest_trigger = Some(trigger);
    }
}

fn set_connection_state(runtime: &Arc<Mutex<EegRuntime>>, kind: ClientKind, connected: bool) {
    if let Ok(mut runtime) = runtime.lock() {
        match kind {
            ClientKind::Eeg => runtime.eeg_connected = connected,
            ClientKind::Trigger => runtime.trigger_connected = connected,
        }
    }
}

fn record_error(runtime: &Arc<Mutex<EegRuntime>>, message: String) {
    if let Ok(mut runtime) = runtime.lock() {
        runtime.last_error = Some(message);
    }
}

fn take_latest_trigger(runtime: &Arc<Mutex<EegRuntime>>) -> Option<u8> {
    runtime
        .lock()
        .ok()
        .and_then(|mut runtime| runtime.latest_trigger.take())
}

fn write_recording_sample(
    runtime: &Arc<Mutex<EegRuntime>>,
    samples_uv: &[f32; EEG_CHANNEL_COUNT],
    trigger: i32,
) {
    if let Ok(mut runtime) = runtime.lock() {
        if let Some(writer) = runtime.recording.as_mut() {
            let _ = writer.write_sample(samples_uv, trigger);
        }
    }
}

fn emit_block(app: &AppHandle, block: EegSampleBlockPayload) {
    let _ = app.emit(EEG_SAMPLE_BLOCK_EVENT, block);
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
        let runtime = Arc::new(Mutex::new(EegRuntime::default()));

        {
            let runtime = runtime.lock().expect("runtime");
            assert!(!runtime.eeg_connected);
            assert!(!runtime.trigger_connected);
        }

        confirm_client_data(&runtime, ClientKind::Eeg);

        {
            let runtime = runtime.lock().expect("runtime");
            assert!(runtime.eeg_connected);
            assert!(!runtime.trigger_connected);
        }

        confirm_client_data(&runtime, ClientKind::Trigger);

        {
            let runtime = runtime.lock().expect("runtime");
            assert!(runtime.eeg_connected);
            assert!(runtime.trigger_connected);
        }
    }
}
